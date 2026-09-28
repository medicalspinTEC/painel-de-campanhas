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

export async function listLeadResponses({
  limit = 50,
  leadId,
  campanhaId,
}: {
  limit?: number
  leadId?: string
  campanhaId?: string
} = {}) {
  const respostas = await prisma.timelineEvent.findMany({
    where: {
      tipo: "resposta",
      ...(leadId ? { leadId } : {}),
      ...(campanhaId ? { campanhaId } : {}),
    },
    include: {
      lead: true,
      campanha: { select: { id: true, nome: true } },
    },
    orderBy: { data: "desc" },
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

export async function listEvents(limit?: number): Promise<EventRow[]> {
  const eventos = await prisma.timelineEvent.findMany({
    select: eventSelect,
    orderBy: { data: "desc" },
    // Pagina no banco: sem `take` o feed carregaria todo o histórico.
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
