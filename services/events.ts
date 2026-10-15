import { prisma } from "@/lib/prisma"
import type { TimelineEvent } from "@/types"

export interface EventRow extends TimelineEvent {
  leadNome: string
  campanhaNome: string | null
  mensagemResumo: string | null
}

/** Limite do trecho de mensagem enviado ao cliente na listagem. */
const MAX_DETALHES = 160

/*
 * As relações vêm no mesmo SELECT via join, evitando consultas extras por
 * evento para resolver o nome do lead, da campanha e da mensagem.
 */
const eventSelect = {
  id: true,
  leadId: true,
  campanhaId: true,
  mensagemId: true,
  tipo: true,
  descricao: true,
  detalhes: true,
  data: true,
  sucesso: true,
  lead: { select: { nome: true } },
  campanha: { select: { nome: true } },
  mensagem: { select: { dia: true, horario: true } },
} as const

type EventRecord = {
  id: string
  leadId: string
  campanhaId: string | null
  mensagemId: string | null
  tipo: TimelineEvent["tipo"]
  descricao: string
  detalhes: string | null
  data: Date
  sucesso: boolean
  lead: { nome: string } | null
  campanha: { nome: string } | null
  mensagem: { dia: number; horario: string } | null
}

function toEventRow(event: EventRecord, truncarDetalhes = true): EventRow {
  const detalhes = event.detalhes ?? undefined
  return {
    id: event.id,
    leadId: event.leadId,
    campanhaId: event.campanhaId,
    mensagemId: event.mensagemId,
    tipo: event.tipo,
    descricao: event.descricao,
    // Trunca para não serializar o texto integral de centenas de mensagens.
    detalhes:
      truncarDetalhes && detalhes && detalhes.length > MAX_DETALHES
        ? `${detalhes.slice(0, MAX_DETALHES).trimEnd()}…`
        : detalhes,
    data: event.data.toISOString(),
    sucesso: event.sucesso,
    leadNome: event.lead?.nome ?? "Lead removido",
    campanhaNome: event.campanha?.nome ?? null,
    mensagemResumo: event.mensagem ? `Dia ${event.mensagem.dia} · ${event.mensagem.horario}` : null,
  }
}

export async function getEvent(id: string): Promise<EventRow | null> {
  const evento = await prisma.timelineEvent.findUnique({ where: { id }, select: eventSelect })
  return evento ? toEventRow(evento, false) : null
}

function filtroRespostas(leadId?: string, campanhaId?: string) {
  return {
    tipo: "resposta" as const,
    ...(leadId ? { leadId } : {}),
    ...(campanhaId ? { campanhaId } : {}),
  }
}

export async function countLeadResponses({ leadId, campanhaId }: { leadId?: string; campanhaId?: string } = {}): Promise<number> {
  return prisma.timelineEvent.count({ where: filtroRespostas(leadId, campanhaId) })
}

export async function listLeadResponses({
  limit = 50,
  offset = 0,
  leadId,
  campanhaId,
}: {
  limit?: number
  /** Quantas respostas pular (paginação). */
  offset?: number
  leadId?: string
  campanhaId?: string
} = {}) {
  const respostas = await prisma.timelineEvent.findMany({
    where: filtroRespostas(leadId, campanhaId),
    include: {
      lead: true,
      campanha: { select: { id: true, nome: true } },
    },
    orderBy: [{ data: "desc" }, { id: "desc" }],
    skip: offset,
    take: limit,
  })

  return respostas.map((resposta) => ({
    id: resposta.id,
    lead: {
      ...resposta.lead,
      criadoEm: resposta.lead.criadoEm.toISOString(),
      atualizadoEm: resposta.lead.atualizadoEm.toISOString(),
      entradaCampanhaEm: resposta.lead.entradaCampanhaEm?.toISOString() ?? null,
    },
    campanha: resposta.campanha,
    dataHora: resposta.data.toISOString(),
    conteudo: resposta.detalhes,
  }))
}

export async function countEvents(): Promise<number> {
  return prisma.timelineEvent.count()
}

export async function listEvents(limit?: number, offset = 0): Promise<EventRow[]> {
  const eventos = await prisma.timelineEvent.findMany({
    select: eventSelect,
    // `id` desempata eventos com a mesma data, para a paginação não repetir nem pular itens.
    orderBy: [{ data: "desc" }, { id: "desc" }],
    // Pagina no banco: sem `take` o feed carregaria todo o histórico.
    ...(offset > 0 ? { skip: offset } : {}),
    ...(limit ? { take: limit } : {}),
  })
  return eventos.map(toEventRow)
}

export async function listFailures(): Promise<EventRow[]> {
  const eventos = await prisma.timelineEvent.findMany({
    where: { tipo: "falha" },
    select: eventSelect,
    orderBy: { data: "desc" },
  })
  return eventos.map(toEventRow)
}

/** Resultado do disparo: `enviado` = mensagem entregue ao provedor; `falha` = o disparo falhou. */
export type ResultadoEnvio = "enviado" | "falha"

export interface FiltrosEnvios {
  campanhaId?: string
  leadId?: string
  resultado?: ResultadoEnvio
  /** Início do período (inclusive). */
  de?: Date
  /** Fim do período (inclusive). */
  ate?: Date
}

function filtroEnvios({ campanhaId, leadId, resultado, de, ate }: FiltrosEnvios) {
  return {
    tipo: resultado === "enviado" ? ("mensagem_enviada" as const) : resultado === "falha" ? ("falha" as const) : { in: ["mensagem_enviada", "falha"] as ("mensagem_enviada" | "falha")[] },
    ...(campanhaId ? { campanhaId } : {}),
    ...(leadId ? { leadId } : {}),
    ...(de || ate ? { data: { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) } } : {}),
  }
}

export async function countEnvios(filtros: FiltrosEnvios = {}): Promise<number> {
  return prisma.timelineEvent.count({ where: filtroEnvios(filtros) })
}

/** Envios de mensagem (enviados e falhas), do mais recente para o mais antigo, já paginados no banco. */
export async function listEnvios(filtros: FiltrosEnvios = {}, { skip = 0, take = 50 }: { skip?: number; take?: number } = {}): Promise<EventRow[]> {
  const eventos = await prisma.timelineEvent.findMany({
    where: filtroEnvios(filtros),
    select: eventSelect,
    orderBy: [{ data: "desc" }, { id: "desc" }],
    skip,
    take,
  })
  return eventos.map(toEventRow)
}

/** Existência de lead/campanha: usada pelo MCP para recusar filtros com ID inexistente em vez de devolver lista vazia. */
export async function leadExiste(id: string): Promise<boolean> {
  return (await prisma.lead.count({ where: { id } })) > 0
}

export async function campanhaExiste(id: string): Promise<boolean> {
  return (await prisma.campaign.count({ where: { id } })) > 0
}
