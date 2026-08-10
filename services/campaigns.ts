import { prisma } from "@/lib/prisma"
import { recordAppLog } from "@/services/app-logs"
import { sendCampaignMessageToLead } from "@/services/evolution"
import { assignCampaign } from "@/services/leads"
import { emitWebhookEvent } from "@/services/webhooks"
import type { Campaign, CampaignMessage, CampaignStatus } from "@/types"

export interface CampaignWithStats extends Campaign {
  totalLeads: number
  leadsQualificados: number
  mensagensEnviadas: number
  respostas: number
  taxaResposta: number
  taxaConversao: number
}

type CampaignRecord = {
  id: string
  nome: string
  descricao: string | null
  status: CampaignStatus
  recorrenciaDias: number
  dataFinal: Date | null
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
    status: record.status,
    recorrenciaDias: record.recorrenciaDias,
    dataFinal: record.dataFinal?.toISOString() ?? null,
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
    return { eventos: new Map<string, { enviadas: number; respostas: number }>(), leads: new Map<string, { total: number; qualificados: number }>() }
  }

  const [porTipo, porCampanha, leadsVinculados] = await Promise.all([
    prisma.timelineEvent.groupBy({
      by: ["campanhaId", "tipo"],
      where: { campanhaId: { in: campaignIds }, tipo: { in: ["mensagem_enviada", "resposta"] } },
      _count: { _all: true },
    }),
    prisma.leadCampaign.groupBy({
      by: ["campanhaId"],
      where: { campanhaId: { in: campaignIds } },
      _count: { _all: true },
    }),
    prisma.leadCampaign.findMany({
      where: { campanhaId: { in: campaignIds } },
      select: { campanhaId: true, lead: { select: { status: true } } },
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

  const leads = new Map<string, { total: number; qualificados: number }>()
  for (const row of porCampanha) {
    const campanhaId = row.campanhaId
    if (!campanhaId) continue
    const atual = leads.get(campanhaId) ?? { total: 0, qualificados: 0 }
    atual.total += row._count._all
    leads.set(campanhaId, atual)
  }

  for (const item of leadsVinculados) {
    const campanhaId = item.campanhaId
    if (!campanhaId) continue
    const atual = leads.get(campanhaId) ?? { total: 0, qualificados: 0 }
    if (item.lead.status === "qualificado") atual.qualificados += 1
    leads.set(campanhaId, atual)
  }

  return { eventos, leads }
}

function withStats(
  campaign: Campaign,
  eventos: { enviadas: number; respostas: number },
  leads: { total: number; qualificados: number },
): CampaignWithStats {
  return {
    ...campaign,
    totalLeads: leads.total,
    leadsQualificados: leads.qualificados,
    mensagensEnviadas: eventos.enviadas,
    respostas: eventos.respostas,
    taxaResposta: eventos.enviadas ? (eventos.respostas / eventos.enviadas) * 100 : 0,
    taxaConversao: leads.total ? (leads.qualificados / leads.total) * 100 : 0,
  }
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
      leads.get(c.id) ?? { total: 0, qualificados: 0 },
    ),
  )
}

export async function getCampaign(id: string): Promise<CampaignWithStats | null> {
  await encerrarCampanhasExpiradas()
  const campanha = await prisma.campaign.findUnique({ where: { id }, include: campaignInclude })
  if (!campanha) return null
  const { eventos, leads } = await loadStats([id])
  return withStats(
    toCampaign(campanha),
    eventos.get(id) ?? { enviadas: 0, respostas: 0 },
    leads.get(id) ?? { total: 0, qualificados: 0 },
  )
}

export interface CampaignInput {
  nome: string
  descricao?: string
  status: CampaignStatus
  recorrenciaDias: number
  dataFinal: string | null
  filtros: Campaign["filtros"]
  leadIds?: string[]
  mensagens: Array<Omit<CampaignMessage, "id"> & { id?: string }>
}

function toCampaignData(input: CampaignInput) {
  return {
    nome: input.nome,
    descricao: input.descricao ?? null,
    status: input.status,
    recorrenciaDias: input.recorrenciaDias,
    dataFinal: input.dataFinal ? new Date(input.dataFinal) : null,
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

async function dispararMensagemInicialParaLeads(campanhaId: string, leadIds: string[] | undefined) {
  if (!leadIds?.length) return

  const campanha = await prisma.campaign.findUnique({
    where: { id: campanhaId },
    select: {
      dataFinal: true,
      mensagens: { orderBy: { dia: "asc" }, select: { id: true, dia: true, texto: true } },
    },
  })

  if (!campanha?.mensagens?.length) return
  // Data limite atingida: não dispara nada e deixa a varredura encerrar a campanha.
  if (campanha.dataFinal && campanha.dataFinal.getTime() < Date.now()) return

  const mensagemInicial = campanha.mensagens.find((mensagem) => mensagem.dia === 0)
  if (!mensagemInicial) return

  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    select: { id: true, telefone: true },
  })

  for (const lead of leads) {
    try {
      await sendCampaignMessageToLead({
        leadId: lead.id,
        campanhaId,
        mensagemId: mensagemInicial.id,
        texto: mensagemInicial.texto,
        telefone: lead.telefone,
      })
    } catch (error) {
      await recordAppLog({
        nivel: "erro",
        origem: "evolution",
        mensagem: `Exceção inesperada ao disparar mensagem inicial para lead ${lead.id} na campanha ${campanhaId}.`,
        detalhes: error,
      })
    }
  }
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
}

export async function createCampaign(input: CampaignInput): Promise<Campaign> {
  const campanha = await prisma.campaign.create({
    data: {
      ...toCampaignData(input),
      // Campanha já criada ativa dispara agora: registra o início.
      reiniciadaEm: input.status === "ativa" ? new Date() : null,
      mensagens: {
        create: input.mensagens.map((m) => ({ dia: m.dia, horario: m.horario, texto: m.texto })),
      },
    },
    include: campaignInclude,
  })

  const criada = toCampaign(campanha)
  await emitWebhookEvent("campanha.criada", { campanha: criada })
  await emitirStatusCampanha(criada, null)
  if (input.leadIds?.length) {
    await sincronizarLeadsDaCampanha(criada.id, input.leadIds)
    if (criada.status === "ativa") {
      await dispararMensagemInicialParaLeads(criada.id, input.leadIds)
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
  const mantidas = input.mensagens.filter((m): m is CampaignMessage => Boolean(m.id))
  const novas = input.mensagens.filter((m) => !m.id)

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
  await sincronizarLeadsDaCampanha(atualizada.id, input.leadIds, id)
  if (input.status === "ativa") {
    await dispararMensagemInicialParaLeads(atualizada.id, input.leadIds)
  }

  return atualizada
}

export async function setCampaignStatus(id: string, status: CampaignStatus): Promise<Campaign | null> {
  const existe = await prisma.campaign.findUnique({ where: { id }, select: { id: true, status: true } })
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
    await dispararMensagemInicialParaLeads(id, leadIds)
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
      recorrenciaDias: original.recorrenciaDias,
      dataFinal: original.dataFinal,
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

/**
 * Calcula o próximo horário previsto de uma mensagem a partir da entrada do
 * lead na campanha. Espelha a lógica exibida na página, mas roda no servidor
 * para servir de fallback quando não há um agendamento manual salvo.
 */
function calcularProximaMensagemPrevista(
  entradaCampanhaEm: Date | null,
  campanha: { recorrenciaDias: number; mensagens: Array<{ dia: number; horario: string }> },
): Date | null {
  if (!entradaCampanhaEm) return null
  const entrada = new Date(entradaCampanhaEm)
  const agora = Date.now()
  const ordenadas = [...campanha.mensagens].sort((a, b) => a.dia - b.dia)

  // A recorrência é o tempo de espera DEPOIS que a última mensagem foi enviada,
  // não o intervalo entre mensagens. Cada ciclo dura, portanto, o dia da última
  // mensagem (span da sequência) + os dias de recorrência antes de reiniciar.
  const ultimoDia = ordenadas.length ? ordenadas[ordenadas.length - 1].dia : 0
  const diasPorCiclo = ultimoDia + campanha.recorrenciaDias

  for (let ciclo = 0; ciclo < 6; ciclo += 1) {
    const base = new Date(entrada)
    base.setDate(base.getDate() + ciclo * diasPorCiclo)
    for (const mensagem of ordenadas) {
      const prevista = new Date(base)
      prevista.setDate(prevista.getDate() + mensagem.dia)
      const [hora, minuto] = mensagem.horario.split(":").map(Number)
      prevista.setHours(hora || 0, minuto || 0, 0, 0)
      if (prevista.getTime() > agora) return prevista
    }
  }
  return null
}

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
 * Usa o agendamento manual (definido ao pular) quando disponível; senão calcula
 * a partir da entrada do lead e, quando a sequência já terminou, projeta a
 * próxima recorrência.
 */
export async function getCampaignSchedule(campanhaId: string): Promise<Record<string, CampaignLeadSchedule>> {
  const campanha = await prisma.campaign.findUnique({
    where: { id: campanhaId },
    select: {
      recorrenciaDias: true,
      reiniciadaEm: true,
      mensagens: { select: { id: true, dia: true, horario: true }, orderBy: { dia: "asc" } },
    },
  })
  if (!campanha) return {}

  const vinculos = await prisma.leadCampaign.findMany({
    where: { campanhaId },
    select: {
      leadId: true,
      criadoEm: true,
      cicloReiniciadoEm: true,
      proximaMensagemEm: true,
      lead: { select: { entradaCampanhaEm: true } },
    },
  })
  if (vinculos.length === 0) return {}

  const enviados = await prisma.timelineEvent.findMany({
    where: { campanhaId, leadId: { in: vinculos.map((v) => v.leadId) }, tipo: "mensagem_enviada" },
    select: { leadId: true, mensagemId: true, data: true },
  })

  const temMensagens = campanha.mensagens.length > 0
  const resultado: Record<string, CampaignLeadSchedule> = {}

  for (const vinculo of vinculos) {
    const marcos = [campanha.reiniciadaEm, vinculo.criadoEm, vinculo.cicloReiniciadoEm].filter(Boolean) as Date[]
    const corte = marcos.length ? new Date(Math.max(...marcos.map((d) => d.getTime()))) : null

    const enviadosDoLead = new Set(
      enviados
        .filter(
          (e) =>
            e.leadId === vinculo.leadId && e.mensagemId && (!corte || e.data.getTime() >= corte.getTime()),
        )
        .map((e) => e.mensagemId as string),
    )
    const pendentes = campanha.mensagens.filter((m) => !enviadosDoLead.has(m.id))
    const aguardandoRecorrencia = temMensagens && pendentes.length === 0

    let proxima: Date | null = null
    if (vinculo.proximaMensagemEm && vinculo.proximaMensagemEm.getTime() > Date.now()) {
      proxima = vinculo.proximaMensagemEm
    } else if (aguardandoRecorrencia) {
      // Toda a sequência já foi percorrida. O reinício acontece a recorrência de
      // dias DEPOIS da última mensagem (dia máximo da sequência a partir do
      // início do ciclo), e não a partir do início do ciclo em si.
      const ultimoDia = campanha.mensagens.length
        ? campanha.mensagens[campanha.mensagens.length - 1].dia
        : 0
      const base = corte ?? new Date()
      proxima = new Date(base)
      proxima.setDate(proxima.getDate() + ultimoDia + campanha.recorrenciaDias)
    } else {
      proxima = calcularProximaMensagemPrevista(vinculo.lead.entradaCampanhaEm, campanha)
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
