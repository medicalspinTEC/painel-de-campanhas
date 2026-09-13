import { prisma } from "@/lib/prisma"
import { decidirCiclo } from "@/lib/campaign-engine-schedule"
import { recordAppLog } from "@/services/app-logs"
import { sendCampaignMessageToLead } from "@/services/evolution"
import { assignCampaign } from "@/services/leads"
import { getSettings } from "@/services/settings"
import { emitWebhookEvent } from "@/services/webhooks"
import type { Campaign, CampaignMessage, CampaignStatus, CampaignTipo, LeadStatus } from "@/types"

export interface CampaignWithStats extends Campaign {
  /**
   * Total histórico de leads da campanha: quem ainda está vinculado (não
   * respondeu) + quem já respondeu e por isso foi desvinculado (ver
   * `services/lead-response.ts`). Não usar apenas a contagem de `LeadCampaign`
   * aqui, pois ela cai a cada resposta e o KPI pareceria "perder" leads.
   */
  totalLeads: number
  /** Quantos desses leads ainda não responderam (continuam vinculados). */
  leadsPendentes: number
  mensagensEnviadas: number
  respostas: number
  taxaResposta: number
  taxaConversao: number
}

type CampaignRecord = {
  id: string
  nome: string
  descricao: string | null
  idImportacao: number
  status: CampaignStatus
  tipo: CampaignTipo
  recorrenciaDias: number
  dataFinal: Date | null
  instanciaNome: string | null
  filtroProduto: string | null
  filtroMarca: string | null
  filtroPersona: string | null
  filtroRegiao: string | null
  criadoEm: Date
  mensagens: Array<{ id: string; dia: number; horario: string; texto: string }>
}

function toCampaign(record: CampaignRecord): Campaign {
  return {
    id: record.id,
    nome: record.nome,
    descricao: record.descricao ?? undefined,
    idImportacao: record.idImportacao,
    status: record.status,
    tipo: record.tipo,
    recorrenciaDias: record.recorrenciaDias,
    dataFinal: record.dataFinal?.toISOString() ?? null,
    instanciaNome: record.instanciaNome ?? null,
    criadoEm: record.criadoEm.toISOString(),
    filtros: {
      produto: record.filtroProduto as Campaign["filtros"]["produto"],
      marca: record.filtroMarca as Campaign["filtros"]["marca"],
      persona: record.filtroPersona as Campaign["filtros"]["persona"],
      regiao: record.filtroRegiao as Campaign["filtros"]["regiao"],
    },
    mensagens: record.mensagens.map(
      (m): CampaignMessage => ({ id: m.id, dia: m.dia, horario: m.horario, texto: m.texto }),
    ),
  }
}

const campaignInclude = {
  mensagens: {
    select: { id: true, dia: true, horario: true, texto: true },
    orderBy: { dia: "asc" as const },
  },
} as const

/**
 * Agregações de desempenho de várias campanhas em duas queries agrupadas,
 * em vez de uma varredura de eventos por campanha.
 */
async function loadStats(campaignIds: string[]) {
  if (campaignIds.length === 0) {
    return {
      eventos: new Map<string, { enviadas: number; respostas: number }>(),
      leads: new Map<string, { pendentes: number; respondidosUnicos: number }>(),
    }
  }

  const [porTipo, porCampanha, respondentesUnicos] = await Promise.all([
    prisma.timelineEvent.groupBy({
      by: ["campanhaId", "tipo"],
      where: { campanhaId: { in: campaignIds }, tipo: { in: ["mensagem_enviada", "resposta"] } },
      _count: { _all: true },
    }),
    // Vínculos atuais: leads ainda na campanha, ou seja, que ainda não responderam.
    prisma.leadCampaign.groupBy({
      by: ["campanhaId"],
      where: { campanhaId: { in: campaignIds } },
      _count: { _all: true },
    }),
    // Quem responde é desvinculado (ver services/lead-response.ts), então o
    // total histórico de leads da campanha precisa somar esses de volta —
    // usamos o evento "resposta" da timeline, agrupado por lead, para contar
    // cada lead uma única vez mesmo que ele tenha respondido mais de uma vez.
    prisma.timelineEvent.groupBy({
      by: ["campanhaId", "leadId"],
      where: { campanhaId: { in: campaignIds }, tipo: "resposta" },
    }),
  ])

  const eventos = new Map<string, { enviadas: number; respostas: number }>()
  for (const row of porTipo) {
    if (!row.campanhaId) continue
    const atual = eventos.get(row.campanhaId) ?? { enviadas: 0, respostas: 0 }
    if (row.tipo === "mensagem_enviada") atual.enviadas += row._count._all
    if (row.tipo === "resposta") atual.respostas += row._count._all
    eventos.set(row.campanhaId, atual)
  }

  const leads = new Map<string, { pendentes: number; respondidosUnicos: number }>()
  for (const row of porCampanha) {
    const campanhaId = row.campanhaId
    if (!campanhaId) continue
    const atual = leads.get(campanhaId) ?? { pendentes: 0, respondidosUnicos: 0 }
    atual.pendentes += row._count._all
    leads.set(campanhaId, atual)
  }

  const respondidosPorCampanha = new Map<string, Set<string>>()
  for (const row of respondentesUnicos) {
    if (!row.campanhaId) continue
    const set = respondidosPorCampanha.get(row.campanhaId) ?? new Set<string>()
    set.add(row.leadId)
    respondidosPorCampanha.set(row.campanhaId, set)
  }
  for (const [campanhaId, set] of respondidosPorCampanha) {
    const atual = leads.get(campanhaId) ?? { pendentes: 0, respondidosUnicos: 0 }
    atual.respondidosUnicos = set.size
    leads.set(campanhaId, atual)
  }

  return { eventos, leads }
}

function withStats(
  campaign: Campaign,
  eventos: { enviadas: number; respostas: number },
  leads: { pendentes: number; respondidosUnicos: number },
): CampaignWithStats {
  const totalLeads = leads.pendentes + leads.respondidosUnicos
  return {
    ...campaign,
    totalLeads,
    leadsPendentes: leads.pendentes,
    mensagensEnviadas: eventos.enviadas,
    respostas: eventos.respostas,
    taxaResposta: eventos.enviadas ? (eventos.respostas / eventos.enviadas) * 100 : 0,
    taxaConversao: totalLeads ? (leads.respondidosUnicos / totalLeads) * 100 : 0,
  }
}

/**
 * Ao encerrar uma campanha, os leads que continuam vinculados a ela não
 * responderam — quem responde é removido de todas as campanhas e marcado como
 * `respondeu` (ver `services/lead-response.ts`). Portanto, para cada campanha
 * encerrada, esses leads remanescentes recebem o status `encerrado` e são
 * desvinculados da campanha.
 *
 * Um lead pode estar em MAIS DE UMA campanha ao mesmo tempo. Só marcamos como
 * `encerrado` quem ficou sem NENHUM outro vínculo depois de sair desta; quem
 * ainda participa de outra campanha ativa apenas perde o vínculo com esta.
 * Quem já respondeu nunca é rebaixado.
 */
async function encerrarLeadsDaCampanha(campanhaId: string) {
  const vinculos = await prisma.leadCampaign.findMany({
    where: { campanhaId },
    select: { leadId: true },
  })
  if (vinculos.length === 0) return
  const leadIds = vinculos.map((v) => v.leadId)

  // 1. Desvincula os leads desta campanha encerrada.
  await prisma.leadCampaign.deleteMany({ where: { campanhaId } })

  // 2. Descobre quem ainda participa de outra campanha; só encerra quem ficou
  //    sem qualquer vínculo.
  const aindaVinculados = await prisma.leadCampaign.findMany({
    where: { leadId: { in: leadIds } },
    select: { leadId: true },
  })
  const comOutraCampanha = new Set(aindaVinculados.map((v) => v.leadId))
  const paraEncerrar = leadIds.filter((id) => !comOutraCampanha.has(id))

  if (paraEncerrar.length > 0) {
    await prisma.lead.updateMany({
      where: { id: { in: paraEncerrar }, status: { not: "respondeu" } },
      data: { status: "encerrado" },
    })
  }

  // 3. Limpa o vínculo legado Lead.campanhaId quando aponta para esta campanha.
  await prisma.lead.updateMany({
    where: { id: { in: leadIds }, campanhaId },
    data: { campanhaId: null, entradaCampanhaEm: null },
  })
}

/**
 * Encerra automaticamente campanhas cuja data limite já passou. Como não há
 * cron, esta varredura é chamada de forma preguiçosa nas leituras: assim uma
 * campanha ativa/pausada com `dataFinal` vencida já aparece — e passa a operar —
 * como "encerrada". Retorna os IDs efetivamente encerrados nesta passagem.
 */
export async function encerrarCampanhasExpiradas(): Promise<string[]> {
  const agora = new Date()
  const expiradas = await prisma.campaign.findMany({
    where: { dataFinal: { not: null, lt: agora }, status: { in: ["ativa", "pausada"] } },
    include: campaignInclude,
  })
  if (expiradas.length === 0) return []

  await prisma.campaign.updateMany({
    where: { id: { in: expiradas.map((c) => c.id) } },
    data: { status: "encerrada" },
  })

  for (const c of expiradas) {
    // Leads remanescentes (não responderam) saem da campanha como "encerrado".
    await encerrarLeadsDaCampanha(c.id)
    await emitirStatusCampanha({ ...toCampaign(c), status: "encerrada" }, c.status)
  }
  return expiradas.map((c) => c.id)
}

export async function listCampaigns(): Promise<CampaignWithStats[]> {
  await encerrarCampanhasExpiradas()
  const campanhas = await prisma.campaign.findMany({
    include: campaignInclude,
    orderBy: { criadoEm: "desc" },
  })
  const { eventos, leads } = await loadStats(campanhas.map((c) => c.id))

  return campanhas.map((c) =>
    withStats(
      toCampaign(c),
      eventos.get(c.id) ?? { enviadas: 0, respostas: 0 },
      leads.get(c.id) ?? { pendentes: 0, respondidosUnicos: 0 },
    ),
  )
}

export interface CampaignSearchItem {
  id: string
  nome: string
  totalLeads: number
}

/**
 * Versão enxuta de `listCampaigns` para a busca global do cabeçalho: id, nome
 * e contagem de leads via `_count` (uma única consulta), sem rodar
 * `encerrarCampanhasExpiradas()` nem as agregações completas de
 * mensagens/respostas de `loadStats`. O cabeçalho aparece em toda navegação
 * do painel, então essa consulta precisa ser barata — a varredura de
 * expiração continua acontecendo normalmente quando a página de Campanhas é
 * visitada (via `listCampaigns`).
 */
export async function listCampaignsForSearch(limit = 40): Promise<CampaignSearchItem[]> {
  const campanhas = await prisma.campaign.findMany({
    select: { id: true, nome: true, _count: { select: { leadCampaigns: true } } },
    orderBy: { criadoEm: "desc" },
    take: limit,
  })
  return campanhas.map((c) => ({ id: c.id, nome: c.nome, totalLeads: c._count.leadCampaigns }))
}

export async function getCampaign(id: string): Promise<CampaignWithStats | null> {
  await encerrarCampanhasExpiradas()
  const campanha = await prisma.campaign.findUnique({ where: { id }, include: campaignInclude })
  if (!campanha) return null
  const { eventos, leads } = await loadStats([id])
  return withStats(
    toCampaign(campanha),
    eventos.get(id) ?? { enviadas: 0, respostas: 0 },
    leads.get(id) ?? { pendentes: 0, respondidosUnicos: 0 },
  )
}

export interface CampaignInput {
  nome: string
  descricao?: string
  status: CampaignStatus
  /** Escolhido na criação; ver `CampaignTipo`. Default `padrao`. */
  tipo?: CampaignTipo
  recorrenciaDias: number
  dataFinal: string | null
  /** Instância que envia as mensagens. Nulo/ausente = padrão do ambiente. */
  instanciaNome?: string | null
  filtros: Campaign["filtros"]
  leadIds?: string[]
  /** Sequência de mensagens. Só usada quando `tipo` é `padrao`. */
  mensagens: Array<Omit<CampaignMessage, "id"> & { id?: string }>
  /**
   * Texto individual por lead (chave = leadId). Só usado quando `tipo` é
   * `individual`; cada lead selecionado precisa de uma entrada aqui.
   */
  leadMensagens?: Record<string, string>
}

function toCampaignData(input: CampaignInput) {
  return {
    nome: input.nome,
    descricao: input.descricao ?? null,
    status: input.status,
    tipo: input.tipo ?? "padrao",
    recorrenciaDias: input.recorrenciaDias,
    dataFinal: input.dataFinal ? new Date(input.dataFinal) : null,
    instanciaNome: input.instanciaNome?.trim() || null,
    filtroProduto: input.filtros.produto ?? null,
    filtroMarca: input.filtros.marca ?? null,
    filtroPersona: input.filtros.persona ?? null,
    filtroRegiao: input.filtros.regiao ?? null,
  }
}

/**
 * Traduz o status da campanha no evento de ciclo de vida correspondente.
 * `rascunho` não gera evento próprio: a campanha ainda não saiu do papel.
 */
const EVENTO_POR_STATUS: Partial<Record<CampaignStatus, string>> = {
  ativa: "campanha.iniciada",
  pausada: "campanha.pausada",
  encerrada: "campanha.encerrada",
}

async function emitirStatusCampanha(campanha: Campaign, anterior: CampaignStatus | null) {
  if (anterior === campanha.status) return
  const evento = EVENTO_POR_STATUS[campanha.status]
  if (evento) await emitWebhookEvent(evento, { campanha, statusAnterior: anterior })
}

/**
 * Aciona a engine de disparo para enviar imediatamente as mensagens devidas
 * (inclusive as de `dia 0`) respeitando o RITMO DE ENVIO configurado: limite
 * diário, tamanho do lote e intervalo entre lotes. Usa import dinâmico para
 * evitar o ciclo de dependência com `campaign-engine`, que importa deste módulo.
 */
async function acionarEngineDeDisparo() {
  try {
    const { processDueMessages } = await import("@/services/campaign-engine")
    await processDueMessages()
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "campaigns",
      mensagem: "Falha ao acionar a engine para disparar as mensagens iniciais das campanhas.",
      detalhes: error,
    })
  }
}

async function dispararMensagemInicialParaLeads(
  campanhaId: string,
  leadIds: string[] | undefined,
  tipo: CampaignTipo = "padrao",
) {
  if (!leadIds?.length) return

  if (tipo === "individual") {
    // Sem "dia 0": a engine dispara qualquer mensagem individual pendente
    // (`mensagemIndividual` preenchido e `enviadaIndividualEm` nulo) respeitando
    // o ritmo de envio, então basta acionar a varredura.
    await acionarEngineDeDisparo()
    return
  }

  const campanha = await prisma.campaign.findUnique({
    where: { id: campanhaId },
    select: {
      dataFinal: true,
      mensagens: { where: { dia: 0 }, select: { id: true } },
    },
  })

  if (!campanha?.mensagens?.length) return
  // Data limite atingida: não dispara nada e deixa a varredura encerrar a campanha.
  if (campanha.dataFinal && campanha.dataFinal.getTime() < Date.now()) return

  // A mensagem de `dia 0` é "imediata", mas precisa respeitar o mesmo ritmo de
  // envio das demais mensagens. Antes ela era disparada direto aqui, em loop,
  // furando o orçamento global (limite diário / lote / intervalo). Como os leads
  // já foram vinculados à campanha (sincronizados antes desta chamada), basta
  // acionar a engine: ela envia a mensagem devida dentro do orçamento e adia o
  // excedente para os próximos ticks — exatamente como as mensagens agendadas.
  await acionarEngineDeDisparo()
}

/**
 * Grava o texto individual de cada lead selecionado (campanhas `individual`).
 * Assume que `sincronizarLeadsDaCampanha` já rodou, então as linhas de
 * `LeadCampaign` para estes leads já existem.
 */
async function sincronizarMensagensIndividuais(campanhaId: string, leadMensagens: Record<string, string> | undefined) {
  const entradas = Object.entries(leadMensagens ?? {})
  if (entradas.length === 0) return
  await Promise.all(
    entradas.map(([leadId, texto]) =>
      prisma.leadCampaign.updateMany({
        where: { campanhaId, leadId },
        data: { mensagemIndividual: texto.trim() || null },
      }),
    ),
  )
}

/**
 * Retorna os IDs de todos os leads que atendem aos filtros de público da
 * campanha. Um filtro nulo ("qualquer") não restringe a dimensão; quando todos
 * os filtros são nulos, todos os leads passam a ser compatíveis.
 */
async function leadsQueAtendemAosFiltros(filtros: Campaign["filtros"]): Promise<string[]> {
  const where: { produto?: string; marca?: string; persona?: string; regiao?: string } = {}
  if (filtros.produto) where.produto = filtros.produto
  if (filtros.marca) where.marca = filtros.marca
  if (filtros.persona) where.persona = filtros.persona
  if (filtros.regiao) where.regiao = filtros.regiao

  const leads = await prisma.lead.findMany({ where, select: { id: true } })
  return leads.map((lead) => lead.id)
}

/**
 * Une os leads selecionados manualmente com os que são compatíveis com os
 * filtros da campanha. É a lista final de leads que devem ficar vinculados:
 * qualquer lead que atende aos filtros entra automaticamente, mesmo sem seleção
 * manual, e quando todos os filtros são "qualquer" toda a base é incluída.
 */
async function leadsFinaisDaCampanha(
  filtros: Campaign["filtros"],
  leadIdsManuais: string[] | undefined,
): Promise<string[]> {
  const compativeis = await leadsQueAtendemAosFiltros(filtros)
  return [...new Set([...(leadIdsManuais ?? []).filter(Boolean), ...compativeis])]
}

async function sincronizarLeadsDaCampanha(campanhaId: string, leadIds: string[] | undefined, campanhaAtualId?: string) {
  const selecionados = new Set((leadIds ?? []).filter(Boolean))
  const atuais = await prisma.leadCampaign.findMany({
    where: { campanhaId: campanhaAtualId ?? campanhaId },
    select: { leadId: true },
  })
  const idsAtuais = new Set(atuais.map((item) => item.leadId))

  for (const leadId of Array.from(idsAtuais)) {
    if (!selecionados.has(leadId)) {
      await prisma.leadCampaign.deleteMany({ where: { leadId, campanhaId: campanhaAtualId ?? campanhaId } })
    }
  }

  for (const leadId of Array.from(selecionados)) {
    if (!idsAtuais.has(leadId)) {
      await prisma.leadCampaign.upsert({
        where: { leadId_campanhaId: { leadId, campanhaId } },
        create: { leadId, campanhaId },
        update: {},
      })
    }
  }

  // Vincular a uma campanha (seleção manual de leads ou correspondência por
  // filtro, na criação/edição da campanha) reflete no status do lead como
  // "em_campanha", independente do status da própria campanha (ativa,
  // pausada ou rascunho). `updateMany` com o filtro de status evita reabrir
  // esse estado para quem já respondeu.
  if (selecionados.size > 0) {
    await prisma.lead.updateMany({
      where: { id: { in: Array.from(selecionados) }, status: { not: "respondeu" } },
      data: { status: "em_campanha" },
    })
  }
}

export async function createCampaign(input: CampaignInput): Promise<Campaign> {
  const tipo = input.tipo ?? "padrao"
  const campanha = await prisma.campaign.create({
    data: {
      ...toCampaignData(input),
      // Campanha já criada ativa dispara agora: registra o início.
      reiniciadaEm: input.status === "ativa" ? new Date() : null,
      mensagens: {
        create: tipo === "padrao" ? input.mensagens.map((m) => ({ dia: m.dia, horario: m.horario, texto: m.texto })) : [],
      },
    },
    include: campaignInclude,
  })

  const criada = toCampaign(campanha)
  await emitWebhookEvent("campanha.criada", { campanha: criada })
  await emitirStatusCampanha(criada, null)
  // Individual: só vincula quem foi selecionado manualmente (não há filtro de
  // público automático, já que leads futuros não teriam mensagem definida).
  const leadIdsFinais =
    tipo === "individual" ? [...new Set((input.leadIds ?? []).filter(Boolean))] : await leadsFinaisDaCampanha(criada.filtros, input.leadIds)
  if (leadIdsFinais.length) {
    await sincronizarLeadsDaCampanha(criada.id, leadIdsFinais)
    if (tipo === "individual") await sincronizarMensagensIndividuais(criada.id, input.leadMensagens)
    if (criada.status === "ativa") {
      await dispararMensagemInicialParaLeads(criada.id, leadIdsFinais, tipo)
    }
  }

  return criada
}

export async function updateCampaign(id: string, input: CampaignInput): Promise<Campaign | null> {
  const existe = await prisma.campaign.findUnique({ where: { id }, select: { id: true, status: true } })
  if (!existe) return null

  /*
   * A sequência é substituída por completo. Removemos apenas as mensagens que
   * saíram do editor e atualizamos as que permaneceram, preservando os ids —
   * assim o histórico de eventos continua apontando para a mensagem correta.
   */
  const tipo = input.tipo ?? "padrao"
  // Individual não usa a sequência: qualquer CampaignMessage remanescente de
  // uma troca de tipo (padrao -> individual) é removida.
  const mantidas = tipo === "padrao" ? input.mensagens.filter((m): m is CampaignMessage => Boolean(m.id)) : []
  const novas = tipo === "padrao" ? input.mensagens.filter((m) => !m.id) : []

  const campanha = await prisma.$transaction(async (tx) => {
    await tx.campaignMessage.deleteMany({
      where: { campanhaId: id, id: { notIn: mantidas.map((m) => m.id) } },
    })
    for (const m of mantidas) {
      await tx.campaignMessage.update({
        where: { id: m.id },
        data: { dia: m.dia, horario: m.horario, texto: m.texto },
      })
    }
    return tx.campaign.update({
      where: { id },
      data: {
        ...toCampaignData(input),
        // Só conta como reinício quando a campanha sai de um estado inativo
        // para "ativa"; editar uma campanha já ativa não deve reenviar tudo.
        ...(input.status === "ativa" && existe.status !== "ativa" ? { reiniciadaEm: new Date() } : {}),
        mensagens: {
          create: novas.map((m) => ({ dia: m.dia, horario: m.horario, texto: m.texto })),
        },
      },
      include: campaignInclude,
    })
  })

  const atualizada = toCampaign(campanha)
  await emitWebhookEvent("campanha.atualizada", { campanha: atualizada })
  await emitirStatusCampanha(atualizada, existe.status)
  const leadIdsFinais =
    tipo === "individual"
      ? [...new Set((input.leadIds ?? []).filter(Boolean))]
      : await leadsFinaisDaCampanha(atualizada.filtros, input.leadIds)
  await sincronizarLeadsDaCampanha(atualizada.id, leadIdsFinais, id)
  if (tipo === "individual") await sincronizarMensagensIndividuais(atualizada.id, input.leadMensagens)
  if (input.status === "ativa") {
    await dispararMensagemInicialParaLeads(atualizada.id, leadIdsFinais, tipo)
  }

  // Encerramento manual pela edição: rodado APÓS a sincronização de leads para
  // que os remanescentes (que não responderam) saiam da campanha já como
  // "encerrado", sem serem reinseridos pelos filtros.
  if (input.status === "encerrada" && existe.status !== "encerrada") {
    await encerrarLeadsDaCampanha(atualizada.id)
  }

  return atualizada
}

export async function setCampaignStatus(id: string, status: CampaignStatus): Promise<Campaign | null> {
  const existe = await prisma.campaign.findUnique({ where: { id }, select: { id: true, status: true, tipo: true } })
  if (!existe) return null
  const campanha = await prisma.campaign.update({
    where: { id },
    // Ativar (ou reativar) a campanha conta como reinício: marcamos o momento
    // para que a mensagem inicial possa ser reenviada aos leads.
    data: { status, ...(status === "ativa" ? { reiniciadaEm: new Date() } : {}) },
    include: campaignInclude,
  })

  const atualizada = toCampaign(campanha)
  await emitirStatusCampanha(atualizada, existe.status)

  if (status === "ativa") {
    const leadsVinculados = await prisma.leadCampaign.findMany({
      where: { campanhaId: id },
      select: { leadId: true },
    })
    const leadIds = leadsVinculados.map((item) => item.leadId)
    await dispararMensagemInicialParaLeads(id, leadIds, atualizada.tipo)
  }

  // Encerramento manual: os leads remanescentes (que não responderam) são
  // marcados como "encerrado" e removidos da campanha.
  if (status === "encerrada" && existe.status !== "encerrada") {
    await encerrarLeadsDaCampanha(id)
  }

  return atualizada
}

export async function duplicateCampaign(id: string): Promise<Campaign | null> {
  const original = await prisma.campaign.findUnique({ where: { id }, include: campaignInclude })
  if (!original) return null

  const copia = await prisma.campaign.create({
    data: {
      nome: `${original.nome} (cópia)`,
      descricao: original.descricao,
      // A cópia nasce como rascunho para não disparar mensagens sem revisão.
      status: "rascunho",
      tipo: original.tipo,
      recorrenciaDias: original.recorrenciaDias,
      dataFinal: original.dataFinal,
      instanciaNome: original.instanciaNome,
      filtroProduto: original.filtroProduto,
      filtroMarca: original.filtroMarca,
      filtroPersona: original.filtroPersona,
      filtroRegiao: original.filtroRegiao,
      mensagens: {
        create: original.mensagens.map((m) => ({ dia: m.dia, horario: m.horario, texto: m.texto })),
      },
    },
    include: campaignInclude,
  })

  const duplicada = toCampaign(copia)
  await emitWebhookEvent("campanha.criada", { campanha: duplicada, duplicadaDe: id })

  return duplicada
}

// ---------------------------------------------------------------------------
// Agendamento por lead / pular mensagem
// ---------------------------------------------------------------------------

export interface CampaignLeadSchedule {
  /** Momento previsto do próximo disparo (ISO) ou null se indefinido. */
  proximaMensagemEm: string | null
  /** true quando toda a sequência já foi percorrida e resta a recorrência. */
  aguardandoRecorrencia: boolean
  /** false quando a campanha não tem mensagens (pular não faz sentido). */
  temMensagens: boolean
}

/**
 * Devolve, por lead vinculado, o agendamento do próximo disparo desta campanha.
 * Usa exatamente o mesmo núcleo (`decidirCiclo`) que a engine de disparo, para
 * que o cronômetro exibido corresponda ao instante em que a engine realmente
 * envia a próxima mensagem.
 */
export async function getCampaignSchedule(campanhaId: string): Promise<Record<string, CampaignLeadSchedule>> {
  const campanha = await prisma.campaign.findUnique({
    where: { id: campanhaId },
    select: {
      recorrenciaDias: true,
      reiniciadaEm: true,
      mensagens: { select: { id: true, dia: true, horario: true, texto: true }, orderBy: { dia: "asc" } },
    },
  })
  if (!campanha) return {}

  const vinculos = await prisma.leadCampaign.findMany({
    where: { campanhaId },
    select: {
      leadId: true,
      criadoEm: true,
      cicloReiniciadoEm: true,
      lead: { select: { entradaCampanhaEm: true } },
    },
  })
  if (vinculos.length === 0) return {}

  const { pausarNoFimDeSemana } = await getSettings()

  const enviados = await prisma.timelineEvent.findMany({
    where: { campanhaId, leadId: { in: vinculos.map((v) => v.leadId) }, tipo: "mensagem_enviada" },
    select: { leadId: true, mensagemId: true, data: true },
  })

  const temMensagens = campanha.mensagens.length > 0
  const agora = new Date()
  const resultado: Record<string, CampaignLeadSchedule> = {}

  for (const vinculo of vinculos) {
    const marcos = [
      campanha.reiniciadaEm,
      vinculo.criadoEm,
      vinculo.cicloReiniciadoEm,
      vinculo.lead.entradaCampanhaEm,
    ].filter(Boolean) as Date[]
    const cycleAnchor = marcos.length
      ? new Date(Math.max(...marcos.map((d) => d.getTime())))
      : vinculo.criadoEm

    // Ciclo reiniciado: a âncora vigente é o marco de recorrência deste lead.
    const cicloReiniciado =
      vinculo.cicloReiniciadoEm != null &&
      cycleAnchor.getTime() === vinculo.cicloReiniciadoEm.getTime()

    const eventosDoCiclo = enviados.filter(
      (e) => e.leadId === vinculo.leadId && e.mensagemId && e.data.getTime() >= cycleAnchor.getTime(),
    )
    const enviadosIds = new Set(eventosDoCiclo.map((e) => e.mensagemId as string))
    // Momento real do último envio deste ciclo — base para contar a recorrência.
    const ultimoEnvioEm = eventosDoCiclo.length
      ? new Date(Math.max(...eventosDoCiclo.map((e) => e.data.getTime())))
      : null

    let proxima: Date | null = null
    let aguardandoRecorrencia = false

    if (temMensagens) {
      const decisao = decidirCiclo(
        {
          cycleAnchor,
          mensagens: campanha.mensagens,
          enviadosIds,
          recorrenciaDias: campanha.recorrenciaDias,
          ultimoEnvioEm,
          cicloReiniciado,
          pausarNoFimDeSemana,
        },
        agora,
      )
      if (decisao.tipo === "enviar") {
        // Alvo já vencido: a engine envia no próximo tick — mostramos "agora".
        proxima = agora
        aguardandoRecorrencia = decisao.aguardandoRecorrencia
      } else if (decisao.tipo === "aguardar") {
        proxima = decisao.proximaEm
        aguardandoRecorrencia = decisao.aguardandoRecorrencia
      } else {
        // reiniciar: o novo ciclo começa agora (dia 0 sai no próximo tick).
        proxima = agora
        aguardandoRecorrencia = false
      }
    }

    resultado[vinculo.leadId] = {
      proximaMensagemEm: proxima?.toISOString() ?? null,
      aguardandoRecorrencia,
      temMensagens,
    }
  }

  return resultado
}

export interface SkipMessageResult {
  ok: boolean
  message: string
  aguardandoRecorrencia?: boolean
  proximaMensagemEm?: string | null
}

/**
 * Envia imediatamente a próxima mensagem pendente de um lead nesta campanha
 * ("pular"). Ao concluir, zera o contador e agenda o próximo disparo:
 *  - se ainda houver mensagens, conta até a próxima da sequência;
 *  - se era a última, inicia a contagem da recorrência até reiniciar.
 * Quando não há mais nada pendente no ciclo, reinicia o ciclo para o lead e
 * dispara a primeira mensagem novamente. Os eventos e a timeline são gravados
 * por `sendCampaignMessageToLead`; falhas caem no AppLog.
 */
export async function skipToNextMessage(leadId: string, campanhaId: string): Promise<SkipMessageResult> {
  const [campanha, vinculo, lead] = await Promise.all([
    prisma.campaign.findUnique({
      where: { id: campanhaId },
      select: {
        recorrenciaDias: true,
        reiniciadaEm: true,
        dataFinal: true,
        instanciaNome: true,
        mensagens: { select: { id: true, dia: true, horario: true, texto: true }, orderBy: { dia: "asc" } },
      },
    }),
    prisma.leadCampaign.findUnique({
      where: { leadId_campanhaId: { leadId, campanhaId } },
      select: { id: true, criadoEm: true, cicloReiniciadoEm: true },
    }),
    prisma.lead.findUnique({ where: { id: leadId }, select: { telefone: true } }),
  ])

  if (!campanha || !vinculo || !lead) return { ok: false, message: "Lead ou campanha não encontrados." }
  if (campanha.mensagens.length === 0)
    return { ok: false, message: "Esta campanha não tem mensagens para enviar." }
  if (campanha.dataFinal && campanha.dataFinal.getTime() < Date.now()) {
    await encerrarCampanhasExpiradas()
    return { ok: false, message: "A data limite da campanha foi atingida. A campanha está encerrada." }
  }

  const marcos = [campanha.reiniciadaEm, vinculo.criadoEm, vinculo.cicloReiniciadoEm].filter(Boolean) as Date[]
  let corte = marcos.length ? new Date(Math.max(...marcos.map((d) => d.getTime()))) : null

  const enviados = await prisma.timelineEvent.findMany({
    where: { campanhaId, leadId, tipo: "mensagem_enviada", ...(corte ? { data: { gte: corte } } : {}) },
    select: { mensagemId: true },
  })
  const enviadosSet = new Set(enviados.map((e) => e.mensagemId).filter(Boolean) as string[])

  let pendentes = campanha.mensagens.filter((m) => !enviadosSet.has(m.id))
  let reiniciouCiclo = false

  // Sequência já concluída no ciclo: reinicia o ciclo só para este lead e volta
  // à primeira mensagem, permitindo o reenvio (a dedupe usa `cicloReiniciadoEm`).
  if (pendentes.length === 0) {
    const agora = new Date()
    await prisma.leadCampaign.update({ where: { id: vinculo.id }, data: { cicloReiniciadoEm: agora } })
    corte = agora
    reiniciouCiclo = true
    pendentes = [...campanha.mensagens]
  }

  const alvo = pendentes[0]
  const restantes = pendentes.slice(1)

  const envio = await sendCampaignMessageToLead({
    leadId,
    campanhaId,
    mensagemId: alvo.id,
    texto: alvo.texto,
    telefone: lead.telefone,
    instanciaNome: campanha.instanciaNome,
    descricaoSucesso: reiniciouCiclo
      ? "Ciclo reiniciado manualmente: primeira mensagem reenviada."
      : "Mensagem antecipada manualmente (pular) na campanha.",
    descricaoFalha: "Falha ao enviar mensagem ao pular na campanha.",
  })

  if (!envio.ok) {
    return { ok: false, message: envio.erro ?? "Não foi possível enviar a próxima mensagem." }
  }

  // Zera o contador: agenda o próximo disparo a partir de agora.
  const agora = new Date()
  let proxima: Date
  let aguardandoRecorrencia: boolean

  if (restantes.length > 0) {
    const seguinte = restantes[0]
    const gapDias = Math.max(0, seguinte.dia - alvo.dia)
    proxima = new Date(agora)
    proxima.setDate(proxima.getDate() + gapDias)
    const [hora, minuto] = seguinte.horario.split(":").map(Number)
    proxima.setHours(hora || 0, minuto || 0, 0, 0)
    // Se caiu no passado (mesmo dia, horário já vencido), joga para o dia seguinte.
    if (proxima.getTime() <= agora.getTime()) proxima.setDate(proxima.getDate() + 1)
    aguardandoRecorrencia = false
  } else {
    // Era a última mensagem: inicia a contagem da recorrência até reiniciar.
    proxima = new Date(agora)
    proxima.setDate(proxima.getDate() + campanha.recorrenciaDias)
    aguardandoRecorrencia = true
  }

  await prisma.leadCampaign.update({
    where: { id: vinculo.id },
    data: { proximaMensagemEm: proxima },
  })

  await emitWebhookEvent("mensagem.pulada", {
    leadId,
    campanhaId,
    mensagemId: alvo.id,
    reiniciouCiclo,
    aguardandoRecorrencia,
    proximaMensagemEm: proxima.toISOString(),
  })

  return {
    ok: true,
    message: aguardandoRecorrencia
      ? "Última mensagem enviada. Contagem de recorrência iniciada."
      : "Mensagem enviada. Contador reiniciado para a próxima.",
    aguardandoRecorrencia,
    proximaMensagemEm: proxima.toISOString(),
  }
}

export interface IndividualLeadMessage {
  mensagem: string
  enviadaEm: string | null
}

/**
 * Texto individual e status de envio por lead, para campanhas `tipo:
 * individual`. Usado no editor (pré-preencher os textos salvos) e na página
 * de detalhe (mostrar o que cada lead vai receber / já recebeu).
 */
export async function getIndividualLeadMessages(campanhaId: string): Promise<Record<string, IndividualLeadMessage>> {
  const vinculos = await prisma.leadCampaign.findMany({
    where: { campanhaId },
    select: { leadId: true, mensagemIndividual: true, enviadaIndividualEm: true },
  })
  const resultado: Record<string, IndividualLeadMessage> = {}
  for (const v of vinculos) {
    resultado[v.leadId] = {
      mensagem: v.mensagemIndividual ?? "",
      enviadaEm: v.enviadaIndividualEm?.toISOString() ?? null,
    }
  }
  return resultado
}

export interface CampaignResponse {
  /** Id do evento de timeline (tipo "resposta"). */
  id: string
  leadId: string
  leadNome: string
  leadTelefone: string
  leadStatus: LeadStatus
  /** Texto/observação da resposta, quando a engine informa o conteúdo. */
  detalhes: string | null
  data: string
}

/**
 * Leads que responderam às mensagens desta campanha. Cada resposta é um
 * `TimelineEvent` do tipo "resposta" gravado por `recordMessageEvent`. Retorna
 * um item por resposta (o mesmo lead pode responder mais de uma vez), do mais
 * recente para o mais antigo.
 */
export async function getCampaignResponses(campanhaId: string): Promise<CampaignResponse[]> {
  const respostas = await prisma.timelineEvent.findMany({
    where: { campanhaId, tipo: "resposta" },
    orderBy: { data: "desc" },
    select: {
      id: true,
      leadId: true,
      detalhes: true,
      data: true,
      lead: { select: { nome: true, telefone: true, status: true } },
    },
  })

  return respostas.map((r) => ({
    id: r.id,
    leadId: r.leadId,
    leadNome: r.lead?.nome ?? "Lead removido",
    leadTelefone: r.lead?.telefone ?? "",
    leadStatus: (r.lead?.status ?? "novo") as LeadStatus,
    detalhes: r.detalhes ?? null,
    data: r.data.toISOString(),
  }))
}

export interface CampaignResponder {
  leadId: string
  leadNome: string
  leadTelefone: string
  leadStatus: LeadStatus
  /** Quantas respostas (eventos) este lead já registrou nesta campanha. */
  totalRespostas: number
  /** Data da resposta mais recente deste lead nesta campanha. */
  ultimaRespostaEm: string
}

/**
 * Mesma origem de dados de `getCampaignResponses` (eventos de timeline tipo
 * "resposta"), mas agregada por lead: uma linha por lead em vez de uma linha
 * por evento de resposta. Como responder faz o lead sair da campanha (a
 * vinculação em `LeadCampaign` é removida — ver `setLeadStatus` e
 * `processarRespostaLead`), esta é a única forma de ver, na própria campanha,
 * quem já respondeu, já que esses leads não aparecem mais em "Leads
 * vinculados". Ordenado da resposta mais recente para a mais antiga.
 */
export async function getCampaignResponders(campanhaId: string): Promise<CampaignResponder[]> {
  const respostas = await prisma.timelineEvent.findMany({
    where: { campanhaId, tipo: "resposta" },
    orderBy: { data: "desc" },
    select: {
      leadId: true,
      data: true,
      lead: { select: { nome: true, telefone: true, status: true } },
    },
  })

  // A consulta já vem ordenada da mais recente para a mais antiga, então a
  // primeira ocorrência de cada leadId é a resposta mais recente dele — daí
  // dar para agregar em uma única passagem, sem reordenar depois.
  const porLead = new Map<string, CampaignResponder>()
  for (const r of respostas) {
    const existente = porLead.get(r.leadId)
    if (existente) {
      existente.totalRespostas += 1
      continue
    }
    porLead.set(r.leadId, {
      leadId: r.leadId,
      leadNome: r.lead?.nome ?? "Lead removido",
      leadTelefone: r.lead?.telefone ?? "",
      leadStatus: (r.lead?.status ?? "novo") as LeadStatus,
      totalRespostas: 1,
      ultimaRespostaEm: r.data.toISOString(),
    })
  }

  return [...porLead.values()]
}

export async function deleteCampaign(id: string): Promise<void> {
  /*
   * `onDelete: SetNull` libera os leads automaticamente, mas os que estavam
   * "em campanha" precisam voltar a "novo" — senão ficariam com um status que
   * não corresponde a nenhuma campanha.
   */
  const [, , , removida] = await prisma.$transaction([
    prisma.leadCampaign.deleteMany({ where: { campanhaId: id } }),
    prisma.lead.updateMany({
      where: { campanhaId: id, status: "em_campanha" },
      data: { status: "novo" },
    }),
    prisma.lead.updateMany({
      where: { campanhaId: id },
      data: { campanhaId: null, entradaCampanhaEm: null },
    }),
    prisma.campaign.delete({ where: { id } }),
  ])

  await emitWebhookEvent("campanha.removida", {
    campanha: { id: removida.id, nome: removida.nome, status: removida.status },
  })
}
