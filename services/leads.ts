import { prisma } from "@/lib/prisma"
import { recordAppLog } from "@/services/app-logs"
import { sendCampaignMessageToLead } from "@/services/evolution"
import { emitWebhookEvent } from "@/services/webhooks"
import type { Lead, LeadStatus, TimelineEvent } from "@/types"

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

export type LeadInput = Pick<Lead, "nome" | "telefone" | "produto" | "marca" | "persona" | "regiao" | "status"> & {
  campanhaId: string | null
  campanhasIds?: string[]
}

export async function createLead(input: LeadInput): Promise<Lead> {
  const agora = new Date()
  const campanha = input.campanhaId
    ? await prisma.campaign.findUnique({ where: { id: input.campanhaId }, select: { nome: true } })
    : null

  const lead = await prisma.lead.create({
    data: {
      nome: input.nome,
      telefone: input.telefone,
      produto: input.produto,
      marca: input.marca,
      persona: input.persona,
      regiao: input.regiao,
      status: input.status,
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

  return criado
}

/**
 * Concentra os eventos derivados de uma troca de status para que toda mutação de
 * lead notifique o mesmo par de eventos, sem repetir a regra em cada função.
 */
async function emitirStatus(lead: Lead, anterior: LeadStatus | null) {
  if (anterior === lead.status) return
  await emitWebhookEvent("lead.status_alterado", { lead, statusAnterior: anterior })
  if (lead.status === "qualificado") await emitWebhookEvent("lead.qualificado", { lead })
}

export async function updateLead(id: string, input: LeadInput): Promise<Lead | null> {
  const atual = await prisma.lead.findUnique({ where: { id }, select: { campanhaId: true, status: true } })
  if (!atual) return null

  const trocouCampanha = atual.campanhaId !== input.campanhaId
  const agora = new Date()

  const campanha =
    trocouCampanha && input.campanhaId
      ? await prisma.campaign.findUnique({ where: { id: input.campanhaId }, select: { nome: true } })
      : null

  const lead = await prisma.lead.update({
    where: { id },
    data: {
      nome: input.nome,
      telefone: input.telefone,
      produto: input.produto,
      marca: input.marca,
      persona: input.persona,
      regiao: input.regiao,
      status: input.status,
      campanhaId: input.campanhaId,
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

  return atualizado
}

async function dispararMensagemInicialDaCampanha(leadId: string, campanhaId: string) {
  const campanha = await prisma.campaign.findUnique({
    where: { id: campanhaId },
    select: { mensagens: { orderBy: { dia: "asc" }, select: { id: true, dia: true, texto: true } } },
  })

  if (!campanha?.mensagens?.length) return

  const mensagemInicial = campanha.mensagens.find((mensagem) => mensagem.dia === 0)
  if (!mensagemInicial) return

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { telefone: true } })
  if (!lead) return

  try {
    await sendCampaignMessageToLead({
      leadId,
      campanhaId,
      mensagemId: mensagemInicial.id,
      texto: mensagemInicial.texto,
      telefone: lead.telefone,
    })
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "evolution",
      mensagem: `Exceção inesperada ao disparar mensagem inicial para lead ${leadId} na campanha ${campanhaId}.`,
      detalhes: error,
    })
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
      ...(status === "qualificado"
        ? {
            eventos: {
              create: {
                campanhaId: lead.campanhaId,
                tipo: "qualificado" as const,
                descricao: "Lead marcado como qualificado pela equipe.",
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

export async function deleteLead(id: string): Promise<void> {
  // Os eventos são removidos em cascata pela FK definida no schema.
  const removido = await prisma.lead.delete({ where: { id } })
  await emitWebhookEvent("lead.removido", { lead: toLead(removido) })
}
