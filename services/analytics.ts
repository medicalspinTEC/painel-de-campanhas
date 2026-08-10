import { prisma } from "@/lib/prisma"
import type { Kpis } from "@/types"

const DAY = 86400000

export async function getKpis(): Promise<Kpis> {
  const agora = new Date()
  const inicioHoje = new Date(agora)
  inicioHoje.setHours(0, 0, 0, 0)

  /*
   * Compara janelas equivalentes: o mesmo número de horas decorridas hoje e
   * ontem. Sem isso, um dia parcial seria comparado a um dia completo e a
   * variação apareceria sempre fortemente negativa de manhã.
   */
  const decorridoMs = agora.getTime() - inicioHoje.getTime()
  const inicioOntem = new Date(inicioHoje.getTime() - DAY)
  const limiteOntem = new Date(inicioOntem.getTime() + decorridoMs)

  const [
    leadsAtivos,
    campanhasAtivas,
    mensagensHoje,
    mensagensOntem,
    totalEnviadas,
    totalRespostas,
    qualificados,
    totalLeads,
  ] = await Promise.all([
    prisma.lead.count({ where: { campanhaId: { not: null }, status: { not: "encerrado" } } }),
    prisma.campaign.count({ where: { status: "ativa" } }),
    prisma.timelineEvent.count({ where: { tipo: "mensagem_enviada", data: { gte: inicioHoje } } }),
    prisma.timelineEvent.count({
      where: { tipo: "mensagem_enviada", data: { gte: inicioOntem, lte: limiteOntem } },
    }),
    prisma.timelineEvent.count({ where: { tipo: "mensagem_enviada" } }),
    prisma.timelineEvent.count({ where: { tipo: "resposta" } }),
    prisma.lead.count({ where: { status: "qualificado" } }),
    prisma.lead.count(),
  ])

  /*
   * Bases muito pequenas (início da madrugada) geram percentuais voláteis e sem
   * significado. Só exibimos a variação com amostra mínima e limitamos a ±100%.
   */
  const variacaoMensagens =
    mensagensOntem >= 5 && mensagensHoje >= 5
      ? Math.max(-100, Math.min(100, ((mensagensHoje - mensagensOntem) / mensagensOntem) * 100))
      : 0

  const taxaResposta = totalEnviadas ? (totalRespostas / totalEnviadas) * 100 : 0
  const taxaQualificacao = totalLeads ? (qualificados / totalLeads) * 100 : 0

  return {
    leadsAtivos,
    campanhasAtivas,
    mensagensHoje,
    leadsQualificados: qualificados,
    taxaResposta,
    taxaQualificacao,
    /*
     * Só a variação de mensagens é comparável hoje: as demais exigiriam
     * snapshots históricos que o schema ainda não guarda. Zero faz a UI
     * renderizar "estável" em vez de um número inventado.
     */
    variacao: {
      leadsAtivos: 0,
      campanhasAtivas: 0,
      mensagensHoje: variacaoMensagens,
      leadsQualificados: 0,
      taxaResposta: 0,
      taxaQualificacao: 0,
    },
  }
}

export interface SeriePonto {
  data: string
  label: string
  enviadas: number
  respostas: number
  qualificados: number
}

/** Chave `YYYY-MM-DD` no fuso local, usada para casar as linhas agregadas. */
function chaveDia(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export async function getSerieDiaria(dias = 30): Promise<SeriePonto[]> {
  const inicio = new Date()
  inicio.setHours(0, 0, 0, 0)
  inicio.setTime(inicio.getTime() - (dias - 1) * DAY)

  /*
   * Agrupa no Postgres por dia e tipo. Buscar os eventos crus e agrupar em JS
   * exigiria carregar o histórico inteiro da janela na memória do servidor.
   * `date_trunc` respeita o fuso da conexão; as chaves são normalizadas abaixo.
   */
  const linhas = await prisma.$queryRaw<Array<{ dia: Date; tipo: string; total: bigint }>>`
    SELECT date_trunc('day', "data") AS dia, "tipo"::text AS tipo, COUNT(*) AS total
    FROM "TimelineEvent"
    WHERE "data" >= ${inicio}
      AND "tipo" IN ('mensagem_enviada', 'resposta', 'qualificado')
    GROUP BY 1, 2
  `

  const porDia = new Map<string, { enviadas: number; respostas: number; qualificados: number }>()
  for (const linha of linhas) {
    const chave = chaveDia(new Date(linha.dia))
    const atual = porDia.get(chave) ?? { enviadas: 0, respostas: 0, qualificados: 0 }
    const total = Number(linha.total)
    if (linha.tipo === "mensagem_enviada") atual.enviadas += total
    if (linha.tipo === "resposta") atual.respostas += total
    if (linha.tipo === "qualificado") atual.qualificados += total
    porDia.set(chave, atual)
  }

  // Preenche todos os dias da janela para o gráfico não ter buracos.
  const pontos: SeriePonto[] = []
  for (let i = 0; i < dias; i++) {
    const d = new Date(inicio.getTime() + i * DAY)
    const valores = porDia.get(chaveDia(d)) ?? { enviadas: 0, respostas: 0, qualificados: 0 }
    pontos.push({
      data: d.toISOString(),
      label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      ...valores,
    })
  }
  return pontos
}

export interface CampanhaPerformance {
  id: string
  nome: string
  leads: number
  enviadas: number
  respostas: number
  qualificados: number
  taxaResposta: number
  taxaConversao: number
  tempoMedioQualificacaoDias: number
}

export async function getPerformancePorCampanha(): Promise<CampanhaPerformance[]> {
  const campanhas = await prisma.campaign.findMany({ select: { id: true, nome: true } })
  if (campanhas.length === 0) return []

  const [eventos, leadsPorCampanha, temposMedios] = await Promise.all([
    prisma.timelineEvent.groupBy({
      by: ["campanhaId", "tipo"],
      where: { campanhaId: { not: null }, tipo: { in: ["mensagem_enviada", "resposta", "qualificado"] } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["campanhaId"],
      where: { campanhaId: { not: null } },
      _count: { _all: true },
    }),
    /*
     * Tempo médio até a qualificação, em dias, calculado no banco. Fazer isso em
     * JS exigiria carregar cada evento de qualificação e cruzar com seu lead.
     */
    prisma.$queryRaw<Array<{ campanhaId: string; dias: number | null }>>`
      SELECT e."campanhaId" AS "campanhaId",
             AVG(EXTRACT(EPOCH FROM (e."data" - l."entradaCampanhaEm")) / 86400) AS dias
      FROM "TimelineEvent" e
      JOIN "Lead" l ON l."id" = e."leadId"
      WHERE e."tipo" = 'qualificado'
        AND e."campanhaId" IS NOT NULL
        AND l."entradaCampanhaEm" IS NOT NULL
        AND e."data" >= l."entradaCampanhaEm"
      GROUP BY 1
    `,
  ])

  const contagem = new Map<string, { enviadas: number; respostas: number; qualificados: number }>()
  for (const row of eventos) {
    if (!row.campanhaId) continue
    const atual = contagem.get(row.campanhaId) ?? { enviadas: 0, respostas: 0, qualificados: 0 }
    if (row.tipo === "mensagem_enviada") atual.enviadas += row._count._all
    if (row.tipo === "resposta") atual.respostas += row._count._all
    if (row.tipo === "qualificado") atual.qualificados += row._count._all
    contagem.set(row.campanhaId, atual)
  }

  const leadsMap = new Map(leadsPorCampanha.map((r) => [r.campanhaId as string, r._count._all]))
  const temposMap = new Map(temposMedios.map((r) => [r.campanhaId, Number(r.dias ?? 0)]))

  return campanhas
    .map((c) => {
      const { enviadas, respostas, qualificados } =
        contagem.get(c.id) ?? { enviadas: 0, respostas: 0, qualificados: 0 }
      const leads = leadsMap.get(c.id) ?? 0
      return {
        id: c.id,
        nome: c.nome,
        leads,
        enviadas,
        respostas,
        qualificados,
        taxaResposta: enviadas ? (respostas / enviadas) * 100 : 0,
        taxaConversao: leads ? (qualificados / leads) * 100 : 0,
        tempoMedioQualificacaoDias: temposMap.get(c.id) ?? 0,
      }
    })
    .sort((a, b) => b.taxaConversao - a.taxaConversao)
}

export interface MensagemPerformance {
  campanha: string
  dia: number
  horario: string
  texto: string
  enviadas: number
  respostas: number
  taxaResposta: number
}

export async function getPerformancePorMensagem(): Promise<MensagemPerformance[]> {
  const [mensagens, eventos] = await Promise.all([
    prisma.campaignMessage.findMany({
      select: {
        id: true,
        dia: true,
        horario: true,
        texto: true,
        campanha: { select: { nome: true } },
      },
    }),
    prisma.timelineEvent.groupBy({
      by: ["mensagemId", "tipo"],
      where: { mensagemId: { not: null }, tipo: { in: ["mensagem_enviada", "resposta"] } },
      _count: { _all: true },
    }),
  ])

  const contagem = new Map<string, { enviadas: number; respostas: number }>()
  for (const row of eventos) {
    if (!row.mensagemId) continue
    const atual = contagem.get(row.mensagemId) ?? { enviadas: 0, respostas: 0 }
    if (row.tipo === "mensagem_enviada") atual.enviadas += row._count._all
    if (row.tipo === "resposta") atual.respostas += row._count._all
    contagem.set(row.mensagemId, atual)
  }

  return mensagens
    .map((m) => {
      const { enviadas, respostas } = contagem.get(m.id) ?? { enviadas: 0, respostas: 0 }
      return {
        campanha: m.campanha.nome,
        dia: m.dia,
        horario: m.horario,
        texto: m.texto,
        enviadas,
        respostas,
        taxaResposta: enviadas ? (respostas / enviadas) * 100 : 0,
      }
    })
    // Mensagens sem disparo não têm taxa a comparar.
    .filter((m) => m.enviadas > 0)
    .sort((a, b) => b.taxaResposta - a.taxaResposta)
}

export interface DimensaoPerformance {
  chave: string
  leads: number
  qualificados: number
  taxaConversao: number
}

export async function getConversaoPorDimensao(
  dimensao: "produto" | "marca" | "persona" | "regiao",
): Promise<DimensaoPerformance[]> {
  const linhas = await prisma.lead.groupBy({
    by: [dimensao, "status"],
    _count: { _all: true },
  })

  const mapa = new Map<string, { leads: number; qualificados: number }>()
  for (const linha of linhas) {
    const chave = linha[dimensao] as string
    const atual = mapa.get(chave) ?? { leads: 0, qualificados: 0 }
    atual.leads += linha._count._all
    if (linha.status === "qualificado") atual.qualificados += linha._count._all
    mapa.set(chave, atual)
  }

  return Array.from(mapa.entries())
    .map(([chave, v]) => ({
      chave,
      leads: v.leads,
      qualificados: v.qualificados,
      taxaConversao: v.leads ? (v.qualificados / v.leads) * 100 : 0,
    }))
    .sort((a, b) => b.taxaConversao - a.taxaConversao)
}

export interface DistribuicaoPonto {
  label: string
  respostas: number
  enviadas: number
  taxa: number
}

const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]

export async function getDistribuicaoPorDiaSemana(): Promise<DistribuicaoPonto[]> {
  // `DOW` do Postgres: 0 = domingo, alinhado com a ordem de DIAS_SEMANA.
  const linhas = await prisma.$queryRaw<Array<{ dow: number; tipo: string; total: bigint }>>`
    SELECT EXTRACT(DOW FROM "data")::int AS dow, "tipo"::text AS tipo, COUNT(*) AS total
    FROM "TimelineEvent"
    WHERE "tipo" IN ('mensagem_enviada', 'resposta')
    GROUP BY 1, 2
  `

  const porDia = new Map<number, { enviadas: number; respostas: number }>()
  for (const linha of linhas) {
    const atual = porDia.get(linha.dow) ?? { enviadas: 0, respostas: 0 }
    const total = Number(linha.total)
    if (linha.tipo === "mensagem_enviada") atual.enviadas += total
    if (linha.tipo === "resposta") atual.respostas += total
    porDia.set(linha.dow, atual)
  }

  return DIAS_SEMANA.map((label, index) => {
    const { enviadas, respostas } = porDia.get(index) ?? { enviadas: 0, respostas: 0 }
    return { label, enviadas, respostas, taxa: enviadas ? (respostas / enviadas) * 100 : 0 }
  })
}

const FAIXAS_HORARIO = [
  { label: "06h-09h", min: 6, max: 9 },
  { label: "09h-12h", min: 9, max: 12 },
  { label: "12h-15h", min: 12, max: 15 },
  { label: "15h-18h", min: 15, max: 18 },
  { label: "18h-21h", min: 18, max: 21 },
  { label: "21h-24h", min: 21, max: 24 },
]

export async function getDistribuicaoPorHorario(): Promise<DistribuicaoPonto[]> {
  const linhas = await prisma.$queryRaw<Array<{ hora: number; tipo: string; total: bigint }>>`
    SELECT EXTRACT(HOUR FROM "data")::int AS hora, "tipo"::text AS tipo, COUNT(*) AS total
    FROM "TimelineEvent"
    WHERE "tipo" IN ('mensagem_enviada', 'resposta')
    GROUP BY 1, 2
  `

  const porHora = new Map<number, { enviadas: number; respostas: number }>()
  for (const linha of linhas) {
    const atual = porHora.get(linha.hora) ?? { enviadas: 0, respostas: 0 }
    const total = Number(linha.total)
    if (linha.tipo === "mensagem_enviada") atual.enviadas += total
    if (linha.tipo === "resposta") atual.respostas += total
    porHora.set(linha.hora, atual)
  }

  return FAIXAS_HORARIO.map((faixa) => {
    let enviadas = 0
    let respostas = 0
    for (let h = faixa.min; h < faixa.max; h++) {
      const valores = porHora.get(h)
      if (!valores) continue
      enviadas += valores.enviadas
      respostas += valores.respostas
    }
    return { label: faixa.label, enviadas, respostas, taxa: enviadas ? (respostas / enviadas) * 100 : 0 }
  })
}

export interface FunilPonto {
  etapa: string
  total: number
}

export async function getFunil(): Promise<FunilPonto[]> {
  /*
   * "Contatados" e "Responderam" contam leads distintos, não eventos: um lead
   * que recebeu cinco mensagens é uma pessoa contatada, não cinco.
   */
  const [total, comCampanha, contatados, responderam, qualificados] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { campanhaId: { not: null } } }),
    prisma.timelineEvent
      .groupBy({ by: ["leadId"], where: { tipo: "mensagem_enviada" } })
      .then((rows) => rows.length),
    prisma.timelineEvent.groupBy({ by: ["leadId"], where: { tipo: "resposta" } }).then((rows) => rows.length),
    prisma.lead.count({ where: { status: "qualificado" } }),
  ])

  return [
    { etapa: "Leads cadastrados", total },
    { etapa: "Em campanha", total: comCampanha },
    { etapa: "Contatados", total: contatados },
    { etapa: "Responderam", total: responderam },
    { etapa: "Qualificados", total: qualificados },
  ]
}
