import { prisma } from "@/lib/prisma"
import {
  getConversaoPorDimensao,
  getDistribuicaoPorDiaSemana,
  getDistribuicaoPorHorario,
  getFunil,
  getKpis,
  getPerformancePorCampanha,
  getPerformancePorMensagem,
  getSerieDiaria,
  type CampanhaPerformance,
  type DimensaoPerformance,
  type DistribuicaoPonto,
  type FunilPonto,
  type MensagemPerformance,
  type SeriePonto,
} from "@/services/analytics"
import { listEvents, type EventRow } from "@/services/events"
import type { Kpis } from "@/types"

export type AssistenteConsulta =
  | "kpis"
  | "relatorios"
  | "dashboard"
  | "semResposta24h"
  | "nuncaResponderam"
  | "semCampanhaAtiva"
  | "respostasRecentes"
  | "semResposta48h"

export type AssistenteLead = {
  id: string
  nome: string
  telefone: string
  campanha: string | null
  referenciaEm: string | null
}

export type AssistenteConsultaResultado = {
  leads: AssistenteLead[]
  total: number
  limite: number
}

export type AssistenteRelatorios = {
  funil: FunilPonto[]
  campanhas: CampanhaPerformance[]
  mensagens: MensagemPerformance[]
  dias: DistribuicaoPonto[]
  horarios: DistribuicaoPonto[]
  segmentos: {
    produto: DimensaoPerformance[]
    marca: DimensaoPerformance[]
    persona: DimensaoPerformance[]
    regiao: DimensaoPerformance[]
  }
}

export type AssistenteDashboard = {
  kpis: Kpis
  atividade: SeriePonto[]
  campanhas: CampanhaPerformance[]
  funil: FunilPonto[]
  eventos: EventRow[]
}

export const LIMITE_LEADS_ASSISTENTE = 100
const DIA_MS = 24 * 60 * 60 * 1000

function limitar(leads: AssistenteLead[], total: number): AssistenteConsultaResultado {
  return { leads: leads.slice(0, LIMITE_LEADS_ASSISTENTE), total, limite: LIMITE_LEADS_ASSISTENTE }
}

async function consultarSemResposta(horas: number): Promise<AssistenteConsultaResultado> {
  const antesDe = new Date(Date.now() - horas * 60 * 60 * 1000)
  const ultimosEnvios = await prisma.timelineEvent.groupBy({
    by: ["leadId"],
    where: { tipo: "mensagem_enviada", sucesso: true },
    _max: { data: true },
  })

  const enviosAntigos = ultimosEnvios.flatMap((evento) => {
    const data = evento._max.data
    return data && data < antesDe ? [{ leadId: evento.leadId, data }] : []
  })
  if (enviosAntigos.length === 0) return limitar([], 0)

  const respostas = await prisma.timelineEvent.groupBy({
    by: ["leadId"],
    where: { leadId: { in: enviosAntigos.map((envio) => envio.leadId) }, tipo: "resposta" },
    _max: { data: true },
  })
  const respostaPorLead = new Map(respostas.map((resposta) => [resposta.leadId, resposta._max.data]))
  const semResposta = enviosAntigos
    .filter((envio) => {
      const respostaEm = respostaPorLead.get(envio.leadId)
      return !respostaEm || respostaEm < envio.data
    })
    .sort((a, b) => a.data.getTime() - b.data.getTime())
  const selecionados = semResposta.slice(0, LIMITE_LEADS_ASSISTENTE)
  const leads = await prisma.lead.findMany({
    where: { id: { in: selecionados.map((envio) => envio.leadId) } },
    select: {
      id: true,
      nome: true,
      telefone: true,
      eventos: {
        where: { tipo: "mensagem_enviada", sucesso: true },
        orderBy: { data: "desc" },
        take: 1,
        select: { campanha: { select: { nome: true } } },
      },
    },
  })
  const leadPorId = new Map(leads.map((lead) => [lead.id, lead]))

  return limitar(
    selecionados.flatMap((envio) => {
      const lead = leadPorId.get(envio.leadId)
      if (!lead) return []
      return [
        {
          id: lead.id,
          nome: lead.nome,
          telefone: lead.telefone,
          campanha: lead.eventos[0]?.campanha?.nome ?? null,
          referenciaEm: envio.data.toISOString(),
        },
      ]
    }),
    semResposta.length,
  )
}

async function consultarNuncaResponderam(): Promise<AssistenteConsultaResultado> {
  const where = { eventos: { none: { tipo: "resposta" as const } } }
  const [total, leads] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: [{ atualizadoEm: "desc" }, { id: "desc" }],
      take: LIMITE_LEADS_ASSISTENTE,
      select: {
        id: true,
        nome: true,
        telefone: true,
        eventos: {
          where: { tipo: "mensagem_enviada", sucesso: true },
          orderBy: { data: "desc" },
          take: 1,
          select: { data: true, campanha: { select: { nome: true } } },
        },
      },
    }),
  ])

  return limitar(
    leads.map((lead) => ({
      id: lead.id,
      nome: lead.nome,
      telefone: lead.telefone,
      campanha: lead.eventos[0]?.campanha?.nome ?? null,
      referenciaEm: lead.eventos[0]?.data.toISOString() ?? null,
    })),
    total,
  )
}

async function consultarSemCampanhaAtiva(): Promise<AssistenteConsultaResultado> {
  const where = { campanhas: { none: { campanha: { is: { status: "ativa" as const } } } } }
  const [total, leads] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: [{ atualizadoEm: "desc" }, { id: "desc" }],
      take: LIMITE_LEADS_ASSISTENTE,
      select: { id: true, nome: true, telefone: true },
    }),
  ])

  return limitar(leads.map((lead) => ({ ...lead, campanha: null, referenciaEm: null })), total)
}

async function consultarRespostasRecentes(): Promise<AssistenteConsultaResultado> {
  const desde = new Date(Date.now() - 7 * DIA_MS)
  const respostas = await prisma.timelineEvent.groupBy({
    by: ["leadId"],
    where: { tipo: "resposta", data: { gte: desde } },
    _max: { data: true },
  })
  respostas.sort((a, b) => (b._max.data?.getTime() ?? 0) - (a._max.data?.getTime() ?? 0))

  const selecionados = respostas.slice(0, LIMITE_LEADS_ASSISTENTE)
  const leads = await prisma.lead.findMany({
    where: { id: { in: selecionados.map((resposta) => resposta.leadId) } },
    select: {
      id: true,
      nome: true,
      telefone: true,
      eventos: {
        where: { tipo: "resposta" },
        orderBy: { data: "desc" },
        take: 1,
        select: { campanha: { select: { nome: true } } },
      },
    },
  })
  const leadPorId = new Map(leads.map((lead) => [lead.id, lead]))

  return limitar(
    selecionados.flatMap((resposta) => {
      const lead = leadPorId.get(resposta.leadId)
      if (!lead || !resposta._max.data) return []
      return [
        {
          id: lead.id,
          nome: lead.nome,
          telefone: lead.telefone,
          campanha: lead.eventos[0]?.campanha?.nome ?? null,
          referenciaEm: resposta._max.data.toISOString(),
        },
      ]
    }),
    respostas.length,
  )
}

export async function consultarAssistente(
  tipo: AssistenteConsulta,
): Promise<
  AssistenteConsultaResultado | { kpis: Kpis } | { relatorios: AssistenteRelatorios } | { dashboard: AssistenteDashboard }
> {
  switch (tipo) {
    case "kpis":
      return { kpis: await getKpis() }
    case "dashboard": {
      const [kpis, atividade, campanhas, funil, eventos] = await Promise.all([
        getKpis(),
        getSerieDiaria(30),
        getPerformancePorCampanha(),
        getFunil(),
        listEvents(8),
      ])
      return {
        dashboard: {
          kpis,
          atividade,
          campanhas: campanhas.filter((campanha) => campanha.leads > 0).slice(0, 6),
          funil,
          eventos,
        },
      }
    }
    case "relatorios": {
      const [funil, campanhas, mensagens, dias, horarios, produto, marca, persona, regiao] = await Promise.all([
        getFunil(),
        getPerformancePorCampanha(),
        getPerformancePorMensagem(),
        getDistribuicaoPorDiaSemana(),
        getDistribuicaoPorHorario(),
        getConversaoPorDimensao("produto"),
        getConversaoPorDimensao("marca"),
        getConversaoPorDimensao("persona"),
        getConversaoPorDimensao("regiao"),
      ])
      return { relatorios: { funil, campanhas, mensagens, dias, horarios, segmentos: { produto, marca, persona, regiao } } }
    }
    case "semResposta24h":
      return consultarSemResposta(24)
    case "semResposta48h":
      return consultarSemResposta(48)
    case "nuncaResponderam":
      return consultarNuncaResponderam()
    case "semCampanhaAtiva":
      return consultarSemCampanhaAtiva()
    case "respostasRecentes":
      return consultarRespostasRecentes()
  }
}