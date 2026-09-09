import { randomUUID } from "node:crypto"

import { prisma } from "@/lib/prisma"
import { renderTemplate } from "@/lib/format"
import { validarTelefoneBR, apenasDigitos } from "@/lib/telefone"
import { recordAppLog } from "@/services/app-logs"
import { emitWebhookEvent } from "@/services/webhooks"
import { sendWhatsAppText } from "@/services/evolution"
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

export interface LeadSearchItem {
  id: string
  nome: string
  produto: string
}

/**
 * Versão enxuta de `listLeads` para a busca global do cabeçalho: só os campos
 * exibidos (id, nome, produto) e limitada a `limit` registros no próprio banco
 * (em vez de carregar TODOS os leads com as agregações de mensagens/respostas
 * e só então cortar em memória com `.slice(0, 40)`, como o cabeçalho fazia
 * antes). Como o cabeçalho aparece em toda navegação do painel, essa consulta
 * roda a cada troca de página — precisa ser barata.
 */
export async function listLeadsForSearch(limit = 40): Promise<LeadSearchItem[]> {
  return prisma.lead.findMany({
    select: { id: true, nome: true, produto: true },
    orderBy: { criadoEm: "desc" },
    take: limit,
  })
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

  // Vincular a uma campanha (pelo campo legado `campanhaId` ou pela lista
  // `campanhasIds`) já na criação reflete no status como "em_campanha",
  // independente do status da própria campanha (ativa, pausada ou
  // rascunho) — ver `statusAoVincularCampanha`.
  const vinculaCampanha = Boolean(input.campanhaId) || Boolean(input.campanhasIds?.length)
  const statusParaGravar = vinculaCampanha ? statusAoVincularCampanha(input.status) : input.status

  const lead = await prisma.lead.create({
    data: {
      nome: input.nome.trim(),
      telefone: telefoneNormalizado,
      produto: input.produto ?? "",
      marca: input.marca ?? "",
      persona: input.persona ?? "",
      regiao: input.regiao ?? "",
      status: statusParaGravar,
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

/** Uma linha já validada (formato) aguardando criação em lote. */
export interface LeadBulkInput {
  nome: string
  telefone: string
  produto?: string
  marca?: string
  persona?: string
  regiao?: string
  notas?: string | null
  status: LeadStatus
  campanhaId: string | null
}

export interface LeadBulkOutcome {
  /** Mesmo índice recebido em `itens`, para o chamador remontar a linha original. */
  index: number
  ok: boolean
  motivo?: string
}

/**
 * Cria muitos leads de uma vez otimizado para lotes grandes (importação de
 * planilha). Aplica as mesmas regras de negócio de `createLead` (telefone com
 * país 55, unicidade de nome/telefone, cadastro automático de segmentação,
 * vinculação a campanhas compatíveis), mas resolvidas para o lote inteiro em
 * vez de uma vez por linha:
 *
 * - a checagem de duplicidade carrega os leads existentes UMA vez (em vez de
 *   uma consulta com TODOS os leads a cada linha, que tornava a importação
 *   quadrática no tamanho da base);
 * - o cadastro automático de produto/marca/persona/região usa `createMany`
 *   (uma consulta por dimensão) em vez de um upsert por linha;
 * - os leads são inseridos com `createMany` (uma única ida ao banco);
 * - a vinculação a campanhas compatíveis é calculada em memória para o lote
 *   inteiro (uma consulta de campanhas) em vez de uma consulta por campanha
 *   por lead;
 * - a engine de disparo roda UMA vez ao final do lote (ela já varre todos os
 *   disparos devidos do sistema), em vez de uma varredura completa por lead.
 */
export async function createLeadsBulk(itens: Array<{ index: number; input: LeadBulkInput }>): Promise<LeadBulkOutcome[]> {
  if (itens.length === 0) return []

  const agora = new Date()
  const resultados: LeadBulkOutcome[] = []

  // 1) Nomes e telefones já cadastrados, carregados uma única vez para todo o
  // lote (evita a consulta O(total de leads) por linha).
  const existentes = await prisma.lead.findMany({ select: { nome: true, telefone: true } })
  const nomesExistentes = new Set(existentes.map((l) => l.nome.trim().toLowerCase()))
  const telefonesExistentes = new Set(existentes.map((l) => apenasDigitos(l.telefone)))

  type Aceito = {
    index: number
    id: string
    nome: string
    telefone: string
    produto: string
    marca: string
    persona: string
    regiao: string
    notas: string | null
    status: LeadStatus
    campanhaId: string | null
  }
  const aceitos: Aceito[] = []

  // 2) Validação de telefone/duplicidade em memória (sem ida ao banco por
  // linha). Cada lead aceito entra imediatamente nos conjuntos de nomes e
  // telefones para pegar duplicidade dentro do próprio arquivo, do mesmo jeito
  // que a checagem sequencial original pegava (linha 5 duplicando a linha 2).
  for (const { index, input } of itens) {
    const nomeLimpo = input.nome.trim()
    const resultadoTelefone = validarTelefoneBR(input.telefone)
    if (!resultadoTelefone.ok) {
      resultados.push({ index, ok: false, motivo: resultadoTelefone.erro ?? "Telefone inválido." })
      continue
    }
    const telefoneNormalizado = resultadoTelefone.normalizado
    const nomeChave = nomeLimpo.toLowerCase()

    if (nomesExistentes.has(nomeChave)) {
      resultados.push({ index, ok: false, motivo: "Já existe um lead cadastrado com este nome." })
      continue
    }
    if (telefonesExistentes.has(telefoneNormalizado)) {
      resultados.push({ index, ok: false, motivo: "Já existe um lead cadastrado com este telefone." })
      continue
    }

    nomesExistentes.add(nomeChave)
    telefonesExistentes.add(telefoneNormalizado)

    aceitos.push({
      index,
      id: randomUUID(),
      nome: nomeLimpo,
      telefone: telefoneNormalizado,
      produto: input.produto ?? "",
      marca: input.marca ?? "",
      persona: input.persona ?? "",
      regiao: input.regiao ?? "",
      notas: normalizarNotas(input.notas),
      status: input.status,
      campanhaId: input.campanhaId,
    })
  }

  if (aceitos.length === 0) return resultados

  // 3) Cadastra em lote qualquer produto/marca/persona/região nova: uma única
  // consulta por dimensão (com `skipDuplicates`) em vez de um upsert por linha.
  const distintos = (valores: string[]) => [...new Set(valores.map((v) => v.trim()).filter(Boolean))]
  try {
    await Promise.all([
      (async () => {
        const nomes = distintos(aceitos.map((l) => l.produto))
        if (nomes.length) await prisma.produto.createMany({ data: nomes.map((nome) => ({ nome, ativo: true })), skipDuplicates: true })
      })(),
      (async () => {
        const nomes = distintos(aceitos.map((l) => l.marca))
        if (nomes.length) await prisma.marca.createMany({ data: nomes.map((nome) => ({ nome, ativo: true })), skipDuplicates: true })
      })(),
      (async () => {
        const nomes = distintos(aceitos.map((l) => l.persona))
        if (nomes.length) await prisma.persona.createMany({ data: nomes.map((nome) => ({ nome, ativo: true })), skipDuplicates: true })
      })(),
      (async () => {
        const nomes = distintos(aceitos.map((l) => l.regiao))
        if (nomes.length) await prisma.regiao.createMany({ data: nomes.map((nome) => ({ nome, ativo: true })), skipDuplicates: true })
      })(),
    ])
  } catch (error) {
    // Complementar, como em `garantirDimensoesSegmentacao`: não impede a
    // criação dos leads.
    await recordAppLog({
      nivel: "aviso",
      origem: "leads",
      mensagem: "Falha ao cadastrar automaticamente dimensões de segmentação durante a importação em lote de leads.",
      detalhes: error,
    })
  }

  // 4) Nomes das campanhas vinculadas explicitamente (para o texto do evento).
  const campanhaIdsExplicitos = [...new Set(aceitos.map((l) => l.campanhaId).filter((id): id is string => Boolean(id)))]
  const campanhasExplicitas = campanhaIdsExplicitos.length
    ? await prisma.campaign.findMany({ where: { id: { in: campanhaIdsExplicitos } }, select: { id: true, nome: true, status: true } })
    : []
  const nomeCampanhaPorId = new Map(campanhasExplicitas.map((c) => [c.id, c.nome]))
  const statusCampanhaExplicitaPorId = new Map(campanhasExplicitas.map((c) => [c.id, c.status]))

  // 5) Insere todos os leads do lote em uma única ida ao banco. Quem já chega
  // com campanha explícita (`campanhaId`) entra direto como "em_campanha",
  // independente do status dessa campanha (ativa, pausada ou rascunho) — ver
  // `statusAoVincularCampanha`. Ajustamos o objeto em memória antes do
  // insert para que o webhook do passo 8 reflita o mesmo status gravado.
  for (const l of aceitos) {
    if (l.campanhaId) l.status = statusAoVincularCampanha(l.status)
  }

  await prisma.lead.createMany({
    data: aceitos.map((l) => ({
      id: l.id,
      nome: l.nome,
      telefone: l.telefone,
      produto: l.produto,
      marca: l.marca,
      persona: l.persona,
      regiao: l.regiao,
      status: l.status,
      notas: l.notas,
      campanhaId: l.campanhaId,
      entradaCampanhaEm: l.campanhaId ? agora : null,
      criadoEm: agora,
    })),
  })

  // 6) Evento "campanha_iniciada" e vínculo para quem já chega com campanha
  // explícita — também em lote.
  const comCampanhaExplicita = aceitos.filter((l): l is Aceito & { campanhaId: string } => Boolean(l.campanhaId))
  if (comCampanhaExplicita.length > 0) {
    await prisma.timelineEvent.createMany({
      data: comCampanhaExplicita.map((l) => ({
        leadId: l.id,
        campanhaId: l.campanhaId,
        tipo: "campanha_iniciada" as const,
        descricao: `Lead entrou na campanha ${nomeCampanhaPorId.get(l.campanhaId) ?? ""}.`,
        data: agora,
        sucesso: true,
      })),
    })
    await prisma.leadCampaign.createMany({
      data: comCampanhaExplicita.map((l) => ({ leadId: l.id, campanhaId: l.campanhaId })),
      skipDuplicates: true,
    })
  }

  // 7) Vincula automaticamente a campanhas compatíveis: mesma regra de
  // `vincularLeadACampanhasCompativeis`, mas com as campanhas carregadas UMA
  // vez e o cruzamento com cada lead feito em memória, em vez de uma consulta
  // de campanhas (e outra de vínculo já existente) por lead.
  const campanhasElegiveis = await prisma.campaign.findMany({
    where: { status: { not: "encerrada" } },
    select: { id: true, status: true, filtroProduto: true, filtroMarca: true, filtroPersona: true, filtroRegiao: true },
  })

  const paresParaVincular: Array<{ leadId: string; campanhaId: string }> = []
  let entrouEmCampanhaAtiva = comCampanhaExplicita.some((l) => statusCampanhaExplicitaPorId.get(l.campanhaId) === "ativa")
  for (const l of aceitos) {
    for (const c of campanhasElegiveis) {
      if (c.id === l.campanhaId) continue // já vinculado no passo 6
      const combina =
        (c.filtroProduto == null || c.filtroProduto === l.produto) &&
        (c.filtroMarca == null || c.filtroMarca === l.marca) &&
        (c.filtroPersona == null || c.filtroPersona === l.persona) &&
        (c.filtroRegiao == null || c.filtroRegiao === l.regiao)
      if (!combina) continue
      paresParaVincular.push({ leadId: l.id, campanhaId: c.id })
      if (c.status === "ativa") entrouEmCampanhaAtiva = true
    }
  }
  if (paresParaVincular.length > 0) {
    await prisma.leadCampaign.createMany({ data: paresParaVincular, skipDuplicates: true })

    // Mesma regra para quem foi vinculado automaticamente por filtro (e
    // ainda não tinha campanha explícita no passo 6): grava no banco e
    // reflete em memória para o webhook do passo 8 usar o status correto.
    const leadIdsAutoVinculados = [...new Set(paresParaVincular.map((p) => p.leadId))]
    await prisma.lead.updateMany({
      where: { id: { in: leadIdsAutoVinculados }, status: { not: "respondeu" } },
      data: { status: "em_campanha" },
    })
    const autoVinculadosSet = new Set(leadIdsAutoVinculados)
    for (const l of aceitos) {
      if (autoVinculadosSet.has(l.id)) l.status = statusAoVincularCampanha(l.status)
    }
  }

  // 8) Notifica os webhooks assinados. `emitWebhookEvent` apenas agenda a
  // entrega (roda depois da resposta), então disparar um por lead aqui não
  // bloqueia a importação.
  for (const l of aceitos) {
    const lead = toLead({ ...l, criadoEm: agora, entradaCampanhaEm: l.campanhaId ? agora : null })
    void emitWebhookEvent("lead.criado", { lead })
    if (l.campanhaId) {
      void emitWebhookEvent("lead.entrou_em_campanha", {
        lead,
        campanha: { id: l.campanhaId, nome: nomeCampanhaPorId.get(l.campanhaId) ?? null },
      })
    }
    if (l.status !== "novo") {
      void emitWebhookEvent("lead.status_alterado", { lead, statusAnterior: "novo" as LeadStatus })
      if (l.status === "respondeu") void emitWebhookEvent("lead.status_alterado", { lead })
    }
  }

  // 9) Uma única varredura da engine cobre os disparos iniciais devidos de
  // todo o lote (ela já varre o sistema inteiro), em vez de uma varredura
  // completa a cada lead importado.
  if (entrouEmCampanhaAtiva) {
    try {
      const { processDueMessages } = await import("@/services/campaign-engine")
      await processDueMessages()
    } catch (error) {
      await recordAppLog({
        nivel: "erro",
        origem: "campaigns",
        mensagem: "Exceção inesperada ao acionar a engine para as mensagens iniciais da importação em lote de leads.",
        detalhes: error,
      })
    }
  }

  for (const l of aceitos) {
    resultados.push({ index: l.index, ok: true })
  }

  return resultados
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

/**
 * Status resultante de vincular um lead a uma campanha. Um lead que passa a
 * ter vínculo em `LeadCampaign` deve refletir isso como "em_campanha",
 * independente do status da própria campanha (ativa, pausada ou rascunho) e
 * de a vinculação ser manual, automática (por filtro) ou por importação em
 * massa. A única exceção é quem já respondeu: responder tira o lead de toda
 * campanha (ver `setLeadStatus`), então uma vinculação posterior não deve
 * reabrir esse estado.
 */
export function statusAoVincularCampanha(statusAtual: LeadStatus): LeadStatus {
  return statusAtual === "respondeu" ? statusAtual : "em_campanha"
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

  // Vincular a uma campanha (pelo campo legado `campanhaId` ou pela lista
  // `campanhasIds`) reflete no status como "em_campanha", independente do
  // status da própria campanha (ativa, pausada ou rascunho) — ver
  // `statusAoVincularCampanha`.
  const vinculaCampanha = Boolean(input.campanhaId) || Boolean(input.campanhasIds?.length)
  const statusParaGravar = vinculaCampanha ? statusAoVincularCampanha(input.status) : input.status

  const lead = await prisma.lead.update({
    where: { id },
    data: {
      nome: input.nome.trim(),
      telefone: telefoneNormalizado,
      status: statusParaGravar,
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

  // Vinculação automática por filtro: reflete no status como "em_campanha",
  // independente do status das campanhas encontradas acima serem ativa,
  // pausada ou rascunho. `updateMany` com o filtro de status evita reabrir
  // esse estado para quem já respondeu.
  await prisma.lead.updateMany({
    where: { id: lead.id, status: { not: "respondeu" } },
    data: { status: "em_campanha" },
  })
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

  // Vinculação manual: reflete no status como "em_campanha", independente do
  // status da própria campanha (ativa, pausada ou rascunho) — ver
  // `statusAoVincularCampanha`.
  const novoStatus = campanhaId ? statusAoVincularCampanha(lead.status) : undefined

  if (campanhaId) {
    await prisma.leadCampaign.upsert({
      where: { leadId_campanhaId: { leadId, campanhaId } },
      create: { leadId, campanhaId },
      update: {},
    })
  } else {
    // "Remover da campanha" (aba Leads): desvincula o lead de TODAS as
    // campanhas às quais está associado. Antes desta chamada os vínculos em
    // LeadCampaign nunca eram apagados quando campanhaId vinha nulo — o
    // código só tratava o caso de adicionar um vínculo, então a consulta
    // abaixo sempre reencontrava os vínculos antigos intactos e recolocava o
    // lead na mesma campanha (por isso ele "nunca saía").
    await prisma.leadCampaign.deleteMany({ where: { leadId } })
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

export async function setLeadStatus(id: string, status: LeadStatus, resposta?: string | null): Promise<Lead | null> {
  const lead = await prisma.lead.findUnique({ where: { id }, select: { campanhaId: true, status: true } })
  if (!lead) return null

  const agora = new Date()

  // Marcar como "respondeu" — manualmente pela tabela/API ou automaticamente
  // pela resposta no WhatsApp (`processarRespostaLead`) — tem que ter o mesmo
  // efeito: o lead sai de toda campanha em que estava. Sem isso, um lead
  // marcado como respondido aqui continuava vinculado em `LeadCampaign` e a
  // engine (que decide quem recebe mensagem só por esse vínculo, sem olhar o
  // status) seguia disparando a sequência normalmente para ele.
  const saiDaCampanha = status === "respondeu"
  const campanhasVinculadas = saiDaCampanha
    ? await prisma.leadCampaign.findMany({
        where: { leadId: id },
        select: { campanha: { select: { nome: true } } },
      })
    : []

  if (saiDaCampanha && campanhasVinculadas.length > 0) {
    await prisma.leadCampaign.deleteMany({ where: { leadId: id } })
  }

  // Ao marcar manualmente, a equipe pode opcionalmente digitar o que o lead
  // respondeu (a interface pergunta isso antes de confirmar). O texto é
  // opcional: sem ele, o evento de resposta fica só com a descrição padrão.
  //
  // "Resposta" e "saída da campanha" são registrados como dois eventos
  // separados (tipos diferentes, ícones diferentes no feed) em vez de um só
  // evento combinado — cada um conta uma coisa distinta e nem toda troca de
  // status para "respondeu" tira o lead de uma campanha.
  const respostaTexto = resposta?.trim() || null
  const eventosParaCriar =
    status === "respondeu"
      ? [
          {
            campanhaId: lead.campanhaId,
            tipo: "resposta" as const,
            descricao: "Lead respondeu.",
            detalhes: respostaTexto ? `Resposta: "${respostaTexto}".` : null,
            data: agora,
            sucesso: true,
          },
          ...(campanhasVinculadas.length > 0
            ? [
                {
                  campanhaId: lead.campanhaId,
                  tipo: "removido_campanha" as const,
                  descricao:
                    campanhasVinculadas.length > 1
                      ? `Lead removido de ${campanhasVinculadas.length} campanhas após responder.`
                      : `Lead removido da campanha ${campanhasVinculadas[0].campanha.nome} após responder.`,
                  detalhes: null,
                  data: agora,
                  sucesso: true,
                },
              ]
            : []),
        ]
      : []

  const atualizado = await prisma.lead.update({
    where: { id },
    data: {
      status,
      ...(saiDaCampanha ? { campanhaId: null, entradaCampanhaEm: null } : {}),
      ...(eventosParaCriar.length > 0 ? { eventos: { create: eventosParaCriar } } : {}),
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

export interface SendLeadMessageResult {
  ok: boolean
  message: string
}

/**
 * Envia uma mensagem avulsa (fora da sequência de qualquer campanha) para um
 * lead específico. Diferente do disparo de campanha:
 *  - não passa pela dedupe de `shouldSendMessage` (é sempre um envio novo);
 *  - o evento fica com `campanhaId: null` e `mensagemId: null` DE PROPÓSITO,
 *    mesmo que o lead esteja vinculado a uma campanha no momento — do
 *    contrário o envio manual seria contado nas estatísticas daquela
 *    campanha (ver `services/campaigns.ts`), o que não faz sentido para uma
 *    mensagem que não faz parte da sequência.
 * O texto aceita as mesmas variáveis do editor de campanhas (ex.:
 * `{{primeiro_nome}}`), resolvidas aqui com o nome do próprio lead.
 */
export async function sendLeadMessage(
  leadId: string,
  texto: string,
  instanciaNome?: string | null,
): Promise<SendLeadMessageResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, nome: true, telefone: true },
  })
  if (!lead) return { ok: false, message: "Lead não encontrado." }

  const textoLimpo = texto.trim()
  if (!textoLimpo) return { ok: false, message: "Escreva uma mensagem antes de enviar." }

  const textoPersonalizado = renderTemplate(textoLimpo, lead.nome.trim())

  const envio = await sendWhatsAppText({
    telefone: lead.telefone,
    texto: textoPersonalizado,
    instanciaNome,
  })

  if (!envio.ok) {
    await prisma.timelineEvent.create({
      data: {
        leadId: lead.id,
        campanhaId: null,
        mensagemId: null,
        tipo: "falha",
        descricao: "Falha ao enviar mensagem individual.",
        detalhes: envio.erro ?? null,
        sucesso: false,
      },
    })
    return { ok: false, message: envio.erro ?? "Não foi possível enviar a mensagem." }
  }

  await prisma.timelineEvent.create({
    data: {
      leadId: lead.id,
      campanhaId: null,
      mensagemId: null,
      tipo: "mensagem_enviada",
      descricao: "Mensagem individual enviada manualmente.",
      detalhes: `Mensagem: "${textoPersonalizado}"`,
      sucesso: true,
    },
  })

  await emitWebhookEvent("mensagem.manual", {
    lead: { id: lead.id, nome: lead.nome, telefone: lead.telefone },
    mensagem: textoPersonalizado,
  })

  return { ok: true, message: "Mensagem enviada." }
}

export interface SendLeadsMessageResult {
  ok: boolean
  message: string
  /** Quantos envios tiveram sucesso. */
  enviados: number
  /** Leads que falharam, com o motivo (para o usuário revisar). */
  erros: Array<{ leadId: string; nome: string; motivo: string }>
}

/**
 * Envia a mesma mensagem avulsa para vários leads de uma vez (seleção em
 * massa na tabela). Reaproveita `sendLeadMessage` lead a lead — cada envio
 * mantém as mesmas regras (personalização por `{{primeiro_nome}}`, evento na
 * timeline com `campanhaId: null`, webhook `mensagem.manual`) — para que o
 * comportamento seja idêntico ao de mandar uma mensagem individual repetidas
 * vezes. Um lead que falhe (ex.: WhatsApp não conectado) não interrompe os
 * demais: cada resultado é coletado e reportado no final.
 */
export async function sendLeadsMessage(
  leadIds: string[],
  texto: string,
  instanciaNome?: string | null,
): Promise<SendLeadsMessageResult> {
  const idsUnicos = [...new Set(leadIds)].filter(Boolean)
  if (idsUnicos.length === 0) {
    return { ok: false, message: "Nenhum lead selecionado.", enviados: 0, erros: [] }
  }

  const textoLimpo = texto.trim()
  if (!textoLimpo) {
    return { ok: false, message: "Escreva uma mensagem antes de enviar.", enviados: 0, erros: [] }
  }

  const leads = await prisma.lead.findMany({
    where: { id: { in: idsUnicos } },
    select: { id: true, nome: true },
  })
  const nomesPorId = new Map(leads.map((l) => [l.id, l.nome]))

  let enviados = 0
  const erros: SendLeadsMessageResult["erros"] = []

  // Envio sequencial (um lead por vez): mesma abordagem já usada para outras
  // ações em lote (ex.: `assignCampaignAction`) e evita disparar dezenas de
  // mensagens simultâneas para a mesma instância do WhatsApp.
  for (const leadId of idsUnicos) {
    const nome = nomesPorId.get(leadId) ?? "(lead removido)"
    if (!nomesPorId.has(leadId)) {
      erros.push({ leadId, nome, motivo: "Lead não encontrado." })
      continue
    }
    try {
      const resultado = await sendLeadMessage(leadId, textoLimpo, instanciaNome)
      if (resultado.ok) {
        enviados++
      } else {
        erros.push({ leadId, nome, motivo: resultado.message })
      }
    } catch (error) {
      await recordAppLog({ origem: "leads", mensagem: `Falha ao enviar mensagem em massa para lead id=${leadId}.`, detalhes: error })
      erros.push({ leadId, nome, motivo: "Erro inesperado ao enviar." })
    }
  }

  const message =
    enviados === 0
      ? "Nenhuma mensagem foi enviada. Revise os erros e tente novamente."
      : `${enviados} mensagem(ns) enviada(s)${erros.length > 0 ? ` · ${erros.length} com erro` : ""}.`

  return { ok: enviados > 0, message, enviados, erros }
}

export async function deleteLead(id: string): Promise<void> {
  // Os eventos são removidos em cascata pela FK definida no schema.
  const removido = await prisma.lead.delete({ where: { id } })
  await emitWebhookEvent("lead.removido", { lead: toLead(removido) })
}

/**
 * Exclui muitos leads de uma vez (usado pela seleção em massa da tabela).
 * Uma única instrução `deleteMany` para o lote inteiro — os eventos e
 * vínculos de campanha de cada lead são removidos em cascata pelas FKs do
 * schema — em vez de um `delete` por lead, que faria uma ida ao banco (e um
 * disparo de webhook aguardado) por item selecionado.
 *
 * Retorna quantos leads foram de fato encontrados e removidos: ids que não
 * existem (mais) são simplesmente ignorados, sem erro.
 */
export async function deleteLeads(ids: string[]): Promise<number> {
  const idsUnicos = [...new Set(ids)].filter(Boolean)
  if (idsUnicos.length === 0) return 0

  // `deleteMany` não devolve os registros removidos, mas o webhook
  // `lead.removido` precisa do conteúdo de cada lead — carregamos antes de
  // excluir, em uma única consulta para o lote inteiro.
  const leadsParaRemover = await prisma.lead.findMany({ where: { id: { in: idsUnicos } } })
  if (leadsParaRemover.length === 0) return 0

  await prisma.lead.deleteMany({ where: { id: { in: idsUnicos } } })

  // A entrega em si roda em background (`emitWebhookEvent` apenas agenda),
  // então notificar um evento por lead aqui não atrasa a resposta.
  for (const lead of leadsParaRemover) {
    void emitWebhookEvent("lead.removido", { lead: toLead(lead) })
  }

  return leadsParaRemover.length
}