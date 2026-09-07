import { prisma } from "@/lib/prisma"
import { validarTelefoneBR, apenasDigitos } from "@/lib/telefone"
import { recordAppLog } from "@/services/app-logs"
import { emitWebhookEvent } from "@/services/webhooks"
import { garantirProduto } from "@/services/produtos"
import { servicoMarcas, servicoPersonas, servicoRegioes } from "@/services/catalogo-segmentacao"
import type { Lead, LeadStatus, TimelineEvent } from "@/types"

/**
 * Cadastra automaticamente no catálogo de segmentação quaisquer valores de
 * produto, marca, persona ou região que ainda não existam. Chamada ao criar ou
 * atualizar um lead: como as requisições POST aceitam qualquer valor de texto
 * nessas dimensões, um valor novo passa a existir como opção sem ação manual.
 * Cada `garantir` é idempotente (upsert por `nome`), então valores vazios ou já
 * cadastrados não geram efeito nem erro.
 */
async function garantirDimensoesSegmentacao(dimensoes: {
  produto?: string | null
  marca?: string | null
  persona?: string | null
  regiao?: string | null
}): Promise<void> {
  const tarefas: Array<Promise<void>> = []
  if (dimensoes.produto) tarefas.push(garantirProduto(dimensoes.produto))
  if (dimensoes.marca) tarefas.push(servicoMarcas.garantir(dimensoes.marca))
  if (dimensoes.persona) tarefas.push(servicoPersonas.garantir(dimensoes.persona))
  if (dimensoes.regiao) tarefas.push(servicoRegioes.garantir(dimensoes.regiao))
  if (tarefas.length === 0) return

  try {
    await Promise.all(tarefas)
  } catch (error) {
    // O cadastro automático é complementar: uma falha aqui não deve impedir a
    // criação/atualização do lead. Apenas registramos para diagnóstico.
    await recordAppLog({
      nivel: "aviso",
      origem: "leads",
      mensagem: "Falha ao cadastrar automaticamente dimensões de segmentação do lead.",
      detalhes: error,
    })
  }
}

function toLeadCampaignIds(campanhas: Array<{ campanhaId: string }> | null | undefined): string[] {
  return (campanhas ?? []).map((item) => item.campanhaId)
}

function toLeadCampaignNames(campanhas: Array<{ campanha?: { nome: string } | null }> | null | undefined): string[] {
  return [...new Set((campanhas ?? []).map((item) => item.campanha?.nome).filter((nome): nome is string => Boolean(nome)))]
}

export interface LeadRow extends Lead {
  campanhasIds: string[]
  campanhasNomes: string[]
  campanhaNome: string | null
  ultimoContato: string | null
  mensagensEnviadas: number
  respostas: number
}

/*
 * As páginas e componentes trabalham com datas como string ISO (serializáveis
 * entre Server e Client Components), enquanto o Prisma devolve `Date`.
 * Os mappers abaixo concentram essa conversão em um único lugar.
 */

type LeadRecord = {
  id: string
  nome: string
  telefone: string
  produto: string
  marca: string
  persona: string
  regiao: string
  status: LeadStatus
  notas: string | null
  campanhaId: string | null
  entradaCampanhaEm: Date | null
  criadoEm: Date
  // Opcional: `createLead`/`updateLead` retornam o registro sem este relacionamento.
  // `toLead` não o utiliza; as listagens que precisam dele usam `leadRowSelect`.
  campanhas?: Array<{ campanhaId: string; campanha?: { nome: string } | null }>
}

function toLead(record: LeadRecord): Lead {
  return {
    id: record.id,
    nome: record.nome,
    telefone: record.telefone,
    produto: record.produto as Lead["produto"],
    marca: record.marca as Lead["marca"],
    persona: record.persona as Lead["persona"],
    regiao: record.regiao as Lead["regiao"],
    status: record.status,
    notas: record.notas ?? null,
    campanhaId: record.campanhaId,
    criadoEm: record.criadoEm.toISOString(),
    entradaCampanhaEm: record.entradaCampanhaEm?.toISOString() ?? null,
  }
}

/*
 * Seleção compartilhada pela listagem e pelo detalhe. As agregações de
 * mensagens/respostas são resolvidas no banco via `_count` para evitar carregar
 * o histórico completo de eventos de cada lead na memória do servidor.
 */
const leadRowSelect = {
  id: true,
  nome: true,
  telefone: true,
  produto: true,
  marca: true,
  persona: true,
  regiao: true,
  status: true,
  notas: true,
  campanhaId: true,
  entradaCampanhaEm: true,
  criadoEm: true,
  campanha: { select: { nome: true } },
  campanhas: { select: { campanhaId: true, campanha: { select: { nome: true } } } },
  _count: {
    select: {
      eventos: { where: { tipo: "mensagem_enviada" as const } },
    },
  },
} as const

type LeadRowRecord = LeadRecord & {
  campanha: { nome: string } | null
  _count: { eventos: number }
}

function toLeadRow(record: LeadRowRecord, respostas: number, ultimoContato: Date | null): LeadRow {
  return {
    ...toLead(record),
    campanhasIds: toLeadCampaignIds(record.campanhas),
    campanhasNomes: toLeadCampaignNames(record.campanhas),
    campanhaNome: record.campanha?.nome ?? null,
    ultimoContato: ultimoContato?.toISOString() ?? null,
    mensagensEnviadas: record._count.eventos,
    respostas,
  }
}

export async function listLeads(): Promise<LeadRow[]> {
  const leads = await prisma.lead.findMany({
    select: leadRowSelect,
    orderBy: { criadoEm: "desc" },
  })
  if (leads.length === 0) return []

  const ids = leads.map((l) => l.id)

  /*
   * Duas agregações em lote em vez de duas consultas por lead: sem isso a
   * listagem faria 2N+1 queries e degradaria linearmente com a base.
   */
  const [respostas, ultimosContatos] = await Promise.all([
    prisma.timelineEvent.groupBy({
      by: ["leadId"],
      where: { leadId: { in: ids }, tipo: "resposta" },
      _count: { _all: true },
    }),
    prisma.timelineEvent.groupBy({
      by: ["leadId"],
      where: { leadId: { in: ids }, tipo: "mensagem_enviada" },
      _max: { data: true },
    }),
  ])

  const respostasPorLead = new Map(respostas.map((r) => [r.leadId, r._count._all]))
  const contatoPorLead = new Map(ultimosContatos.map((r) => [r.leadId, r._max.data]))

  return leads.map((lead) =>
    toLeadRow(lead, respostasPorLead.get(lead.id) ?? 0, contatoPorLead.get(lead.id) ?? null),
  )
}

export async function getLead(id: string): Promise<LeadRow | null> {
  const lead = await prisma.lead.findUnique({ where: { id }, select: leadRowSelect })
  if (!lead) return null

  const [respostas, ultimoContato] = await Promise.all([
    prisma.timelineEvent.count({ where: { leadId: id, tipo: "resposta" } }),
    prisma.timelineEvent.findFirst({
      where: { leadId: id, tipo: "mensagem_enviada" },
      orderBy: { data: "desc" },
      select: { data: true },
    }),
  ])

  return toLeadRow(lead, respostas, ultimoContato?.data ?? null)
}

export async function getLeadTimeline(id: string): Promise<TimelineEvent[]> {
  const eventos = await prisma.timelineEvent.findMany({
    where: { leadId: id },
    orderBy: { data: "desc" },
  })
  return eventos.map((e) => ({
    id: e.id,
    leadId: e.leadId,
    campanhaId: e.campanhaId,
    mensagemId: e.mensagemId,
    tipo: e.tipo,
    descricao: e.descricao,
    detalhes: e.detalhes ?? undefined,
    data: e.data.toISOString(),
    sucesso: e.sucesso,
  }))
}

export type LeadInput = Pick<Lead, "nome" | "telefone" | "status"> & {
  // Apenas `nome` e `telefone` são obrigatórios. As dimensões de segmentação
  // são opcionais: quando omitidas, gravamos string vazia (a coluna não é
  // nullable no schema).
  produto?: Lead["produto"] | ""
  marca?: Lead["marca"] | ""
  persona?: Lead["persona"] | ""
  regiao?: Lead["regiao"] | ""
  // Anotação livre exibida nos detalhes do lead. `null`/"" limpam o campo.
  notas?: string | null
  campanhaId: string | null
  campanhasIds?: string[]
}

/** Normaliza a nota recebida: vazio vira `null`. */
function normalizarNotas(notas: string | null | undefined): string | null {
  if (notas == null) return null
  const limpo = notas.trim()
  return limpo.length > 0 ? limpo : null
}

/**
 * Erro de validação de lead que carrega os campos com problema. As camadas
 * chamadoras (server actions e API REST) capturam e convertem em erros de
 * formulário sem precisar repetir a regra de negócio.
 */
export class LeadValidationError extends Error {
  errors: Record<string, string>
  constructor(errors: Record<string, string>) {
    super("Dados do lead inválidos.")
    this.name = "LeadValidationError"
    this.errors = errors
  }
}

/**
 * Valida o telefone (formato BR com país 55) e garante que não haja outro lead
 * com o mesmo nome ou o mesmo telefone. Retorna o telefone já normalizado (só
 * dígitos) que deve ser gravado. Lança `LeadValidationError` em caso de
 * conflito ou formato inválido.
 *
 * `ignorarId` permite pular o próprio lead na checagem de duplicidade durante
 * uma atualização (senão o lead colidiria consigo mesmo).
 */
async function validarUnicidadeEtelefone(
  nome: string,
  telefone: string,
  ignorarId?: string,
): Promise<string> {
  const errors: Record<string, string> = {}

  // 1) Formato do telefone: precisa incluir o código do país 55.
  const resultadoTelefone = validarTelefoneBR(telefone)
  if (!resultadoTelefone.ok) {
    errors.telefone = resultadoTelefone.erro ?? "Telefone inválido."
  }
  const telefoneNormalizado = resultadoTelefone.normalizado

  const nomeLimpo = nome.trim()

  // 2) Duplicidade de nome (case-insensitive) e de telefone. Comparamos o
  // telefone por dígitos removendo máscara de registros antigos que possam ter
  // sido gravados com formatação.
  const [leadMesmoNome, candidatosMesmoTelefone] = await Promise.all([
    prisma.lead.findFirst({
      where: {
        nome: { equals: nomeLimpo, mode: "insensitive" },
        ...(ignorarId ? { id: { not: ignorarId } } : {}),
      },
      select: { id: true },
    }),
    telefoneNormalizado.length > 0
      ? prisma.lead.findMany({
          where: ignorarId ? { id: { not: ignorarId } } : {},
          select: { id: true, telefone: true },
        })
      : Promise.resolve([]),
  ])

  if (leadMesmoNome) {
    errors.nome = "Já existe um lead cadastrado com este nome."
  }

  const telefoneDuplicado = candidatosMesmoTelefone.some(
    (lead) => apenasDigitos(lead.telefone) === telefoneNormalizado,
  )
  if (telefoneDuplicado && !errors.telefone) {
    errors.telefone = "Já existe um lead cadastrado com este telefone."
  }

  if (Object.keys(errors).length > 0) {
    throw new LeadValidationError(errors)
  }

  return telefoneNormalizado
}

export async function createLead(input: LeadInput): Promise<Lead> {
  const agora = new Date()

  // Impede telefone sem país 55 e cadastros duplicados de nome/telefone.
  // Devolve o telefone normalizado (só dígitos) que será gravado.
  const telefoneNormalizado = await validarUnicidadeEtelefone(input.nome, input.telefone)

  // Cadastra automaticamente no catálogo qualquer produto/marca/persona/região
  // que ainda não exista, antes de gravar o lead.
  await garantirDimensoesSegmentacao({
    produto: input.produto,
    marca: input.marca,
    persona: input.persona,
    regiao: input.regiao,
  })

  const campanha = input.campanhaId
    ? await prisma.campaign.findUnique({ where: { id: input.campanhaId }, select: { nome: true } })
    : null

  const lead = await prisma.lead.create({
    data: {
      nome: input.nome.trim(),
      telefone: telefoneNormalizado,
      produto: input.produto ?? "",
      marca: input.marca ?? "",
      persona: input.persona ?? "",
      regiao: input.regiao ?? "",
      status: input.status,
      notas: normalizarNotas(input.notas),
      campanhaId: input.campanhaId,
      entradaCampanhaEm: input.campanhaId ? agora : null,
      campanhas: {
        create: (input.campanhasIds ?? []).filter(Boolean).map((campanhaId) => ({ campanha: { connect: { id: campanhaId } } })),
      },
      // Registra a entrada na campanha na mesma transação implícita do create.
      eventos: input.campanhaId
        ? {
            create: {
              campanhaId: input.campanhaId,
              tipo: "campanha_iniciada",
              descricao: `Lead entrou na campanha ${campanha?.nome ?? ""}.`,
              data: agora,
              sucesso: true,
            },
          }
        : undefined,
    },
  })

  const criado = toLead(lead)
  await emitWebhookEvent("lead.criado", { lead: criado })
  if (criado.campanhaId) {
    await emitWebhookEvent("lead.entrou_em_campanha", {
      lead: criado,
      campanha: { id: criado.campanhaId, nome: campanha?.nome ?? null },
    })
    await dispararMensagemInicialDaCampanha(criado.id, criado.campanhaId)
  }
  await emitirStatus(criado, "novo")

  // Vincula o lead recém-criado a qualquer campanha ativa/pausada/rascunho cujos
  // filtros ele já atenda, sem depender de seleção manual na campanha.
  await vincularLeadACampanhasCompativeis({
    id: criado.id,
    produto: criado.produto,
    marca: criado.marca,
    persona: criado.persona,
    regiao: criado.regiao,
  })

  return criado
}

/**
 * Concentra os eventos derivados de uma troca de status para que toda mutação de
 * lead notifique o mesmo par de eventos, sem repetir a regra em cada função.
 */
async function emitirStatus(lead: Lead, anterior: LeadStatus | null) {
  if (anterior === lead.status) return
  await emitWebhookEvent("lead.status_alterado", { lead, statusAnterior: anterior })
  if (lead.status === "respondeu") await emitWebhookEvent("lead.status_alterado", { lead })
}

export async function updateLead(id: string, input: LeadInput): Promise<Lead | null> {
  const atual = await prisma.lead.findUnique({ where: { id }, select: { campanhaId: true, status: true } })
  if (!atual) return null

  // Mesmas regras da criação, ignorando o próprio lead na checagem de duplicidade.
  const telefoneNormalizado = await validarUnicidadeEtelefone(input.nome, input.telefone, id)

  // Cadastra automaticamente no catálogo os valores de segmentação enviados que
  // ainda não existam (somente as dimensões presentes no corpo da requisição).
  await garantirDimensoesSegmentacao({
    produto: input.produto,
    marca: input.marca,
    persona: input.persona,
    regiao: input.regiao,
  })

  const trocouCampanha = atual.campanhaId !== input.campanhaId
  const agora = new Date()

  const campanha =
    trocouCampanha && input.campanhaId
      ? await prisma.campaign.findUnique({ where: { id: input.campanhaId }, select: { nome: true } })
      : null

  const lead = await prisma.lead.update({
    where: { id },
    data: {
      nome: input.nome.trim(),
      telefone: telefoneNormalizado,
      status: input.status,
      campanhaId: input.campanhaId,
      // Dimensões de segmentação são opcionais: só sobrescrevem quando enviadas.
      ...(input.produto !== undefined ? { produto: input.produto } : {}),
      ...(input.marca !== undefined ? { marca: input.marca } : {}),
      ...(input.persona !== undefined ? { persona: input.persona } : {}),
      ...(input.regiao !== undefined ? { regiao: input.regiao } : {}),
      // Nota também é opcional: só atualiza quando a chave veio no corpo.
      ...(input.notas !== undefined ? { notas: normalizarNotas(input.notas) } : {}),
      ...(trocouCampanha ? { entradaCampanhaEm: input.campanhaId ? agora : null } : {}),
      ...(trocouCampanha && input.campanhaId
        ? {
            eventos: {
              create: {
                campanhaId: input.campanhaId,
                tipo: "campanha_iniciada" as const,
                descricao: `Lead entrou na campanha ${campanha?.nome ?? ""}.`,
                data: agora,
                sucesso: true,
              },
            },
          }
        : {}),
    },
  })

  if (input.campanhasIds) {
    const campanhasAtuais = await prisma.leadCampaign.findMany({ where: { leadId: id }, select: { campanhaId: true } })
    const paraRemover = campanhasAtuais.map((item) => item.campanhaId).filter((campanhaId) => !input.campanhasIds!.includes(campanhaId))
    const paraAdicionar = input.campanhasIds.filter((campanhaId) => !campanhasAtuais.some((item) => item.campanhaId === campanhaId))

    if (paraRemover.length > 0) {
      await prisma.leadCampaign.deleteMany({ where: { leadId: id, campanhaId: { in: paraRemover } } })
    }
    if (paraAdicionar.length > 0) {
      await prisma.leadCampaign.createMany({ data: paraAdicionar.map((campanhaId) => ({ leadId: id, campanhaId })) })
    }
  }

  const atualizado = toLead(lead)
  await emitWebhookEvent("lead.atualizado", { lead: atualizado })
  if (trocouCampanha && input.campanhaId) {
    await emitWebhookEvent("lead.entrou_em_campanha", {
      lead: atualizado,
      campanha: { id: input.campanhaId, nome: campanha?.nome ?? null },
    })
    await dispararMensagemInicialDaCampanha(atualizado.id, input.campanhaId)
  }
  await emitirStatus(atualizado, atual.status)

  // Como as dimensões de segmentação podem ter mudado, revalida a vinculação
  // automática: o lead entra em qualquer campanha não encerrada cujos filtros
  // ele passou a atender.
  await vincularLeadACampanhasCompativeis({
    id: atualizado.id,
    produto: lead.produto,
    marca: lead.marca,
    persona: lead.persona,
    regiao: lead.regiao,
  })

  return atualizado
}

async function dispararMensagemInicialDaCampanha(leadId: string, campanhaId: string) {
  const campanha = await prisma.campaign.findUnique({
    where: { id: campanhaId },
    select: {
      status: true,
      mensagens: { where: { dia: 0 }, select: { id: true } },
    },
  })

  if (!campanha) return

  // Regra central: só disparamos mensagem quando a campanha está ativa. O lead
  // pode ser vinculado normalmente a campanhas em rascunho, pausadas ou
  // encerradas — o disparo fica retido até a campanha ser ativada.
  if (campanha.status !== "ativa") return

  // Sem mensagem de `dia 0` não há nada imediato para disparar.
  if (!campanha.mensagens?.length) return

  // A mensagem de `dia 0` é imediata, mas precisa respeitar o mesmo ritmo de
  // envio (limite diário / lote / intervalo) das mensagens agendadas. Em vez de
  // enviá-la direto aqui — o que furava o orçamento global — acionamos a engine.
  // O lead já está vinculado à campanha neste ponto, então a engine seleciona a
  // mensagem devida e a envia dentro do orçamento, adiando o excedente para os
  // próximos ticks.
  try {
    const { processDueMessages } = await import("@/services/campaign-engine")
    await processDueMessages()
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "campaigns",
      mensagem: `Exceção inesperada ao acionar a engine para a mensagem inicial do lead ${leadId} na campanha ${campanhaId}.`,
      detalhes: error,
    })
  }
}

/**
 * Vincula automaticamente o lead a todas as campanhas ainda não encerradas cujos
 * filtros de público ele atende. Um filtro nulo na campanha ("qualquer") não
 * restringe a dimensão — uma campanha com todos os filtros "qualquer" captura
 * qualquer lead. As campanhas ativas recém-vinculadas disparam a mensagem
 * inicial (a dedupe do envio evita reenvios). O vínculo é idempotente, então
 * campanhas já vinculadas ao lead não geram efeito.
 */
async function vincularLeadACampanhasCompativeis(lead: {
  id: string
  produto: string
  marca: string
  persona: string
  regiao: string
}): Promise<void> {
  const campanhas = await prisma.campaign.findMany({
    where: {
      status: { not: "encerrada" },
      AND: [
        { OR: [{ filtroProduto: null }, { filtroProduto: lead.produto }] },
        { OR: [{ filtroMarca: null }, { filtroMarca: lead.marca }] },
        { OR: [{ filtroPersona: null }, { filtroPersona: lead.persona }] },
        { OR: [{ filtroRegiao: null }, { filtroRegiao: lead.regiao }] },
      ],
    },
    select: { id: true, status: true },
  })
  if (campanhas.length === 0) return

  for (const campanha of campanhas) {
    const jaVinculado = await prisma.leadCampaign.findUnique({
      where: { leadId_campanhaId: { leadId: lead.id, campanhaId: campanha.id } },
      select: { id: true },
    })
    if (!jaVinculado) {
      await prisma.leadCampaign.create({ data: { leadId: lead.id, campanhaId: campanha.id } })
    }
    if (campanha.status === "ativa") {
      await dispararMensagemInicialDaCampanha(lead.id, campanha.id)
    }
  }
}

export async function assignCampaign(leadId: string, campanhaId: string | null): Promise<Lead | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { campanhaId: true, status: true, campanha: { select: { nome: true } } },
  })
  if (!lead) return null

  const agora = new Date()
  const novaCampanha = campanhaId
    ? await prisma.campaign.findUnique({ where: { id: campanhaId }, select: { nome: true } })
    : null

  const novoStatus =
    campanhaId && (lead.status === "novo" || lead.status === "encerrado") ? "em_campanha" : undefined

  if (campanhaId) {
    await prisma.leadCampaign.upsert({
      where: { leadId_campanhaId: { leadId, campanhaId } },
      create: { leadId, campanhaId },
      update: {},
    })
  }

  const campanhasVinculadas = await prisma.leadCampaign.findMany({ where: { leadId }, select: { campanhaId: true } })
  const campanhaPrincipal = campanhasVinculadas[0]?.campanhaId ?? null

  const atualizado = await prisma.lead.update({
    where: { id: leadId },
    data: {
      campanhaId: campanhaPrincipal,
      entradaCampanhaEm: campanhaPrincipal ? agora : null,
      ...(novoStatus ? { status: novoStatus } : {}),
      ...(campanhaId ? { eventos: { create: { campanhaId, tipo: "campanha_iniciada", descricao: `Lead entrou na campanha ${novaCampanha?.nome ?? ""}.`, data: agora, sucesso: true } } } : {}),
    },
  })

  const resultado = toLead(atualizado)
  if (campanhaId) {
    await emitWebhookEvent("lead.entrou_em_campanha", {
      lead: resultado,
      campanha: { id: campanhaId, nome: novaCampanha?.nome ?? null },
    })
    await dispararMensagemInicialDaCampanha(leadId, campanhaId)
  }
  await emitirStatus(resultado, lead.status)

  return resultado
}

export async function setLeadStatus(id: string, status: LeadStatus): Promise<Lead | null> {
  const lead = await prisma.lead.findUnique({ where: { id }, select: { campanhaId: true, status: true } })
  if (!lead) return null

  const atualizado = await prisma.lead.update({
    where: { id },
    data: {
      status,
      ...(status === "respondeu"
        ? {
            eventos: {
              create: {
                campanhaId: lead.campanhaId,
                tipo: "resposta" as const,
                descricao: "Lead respondeu.",
                data: new Date(),
                sucesso: true,
              },
            },
          }
        : {}),
    },
  })

  const resultado = toLead(atualizado)
  await emitirStatus(resultado, lead.status)

  return resultado
}

/**
 * Atualiza as anotações livres do lead. Notas são opcionais: uma string vazia
 * limpa o campo (guardado como `null`). Não gera evento nem webhook — é uma
 * informação interna da equipe, sem reflexo na engine de follow-up.
 */
export async function updateLeadNotes(id: string, notas: string): Promise<Lead | null> {
  const existe = await prisma.lead.findUnique({ where: { id }, select: { id: true } })
  if (!existe) return null

  const limpo = notas.trim()
  const lead = await prisma.lead.update({
    where: { id },
    data: { notas: limpo.length > 0 ? limpo : null },
  })

  return toLead(lead)
}

export async function deleteLead(id: string): Promise<void> {
  // Os eventos são removidos em cascata pela FK definida no schema.
  const removido = await prisma.lead.delete({ where: { id } })
  await emitWebhookEvent("lead.removido", { lead: toLead(removido) })
}
