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

function toEventRow(event: EventRecord): EventRow {
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
      detalhes && detalhes.length > MAX_DETALHES ? `${detalhes.slice(0, MAX_DETALHES).trimEnd()}…` : detalhes,
    data: event.data.toISOString(),
    sucesso: event.sucesso,
    leadNome: event.lead?.nome ?? "Lead removido",
    campanhaNome: event.campanha?.nome ?? null,
    mensagemResumo: event.mensagem ? `Dia ${event.mensagem.dia} · ${event.mensagem.horario}` : null,
  }
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
