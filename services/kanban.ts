import { prisma } from "@/lib/prisma"
import { LEAD_STATUS_LABEL, type CampaignStatus, type CampaignTipo, type LeadStatus } from "@/types"

/** Ordem das colunas: a mesma ordem dos status já existentes na plataforma. */
export const KANBAN_COLUNAS = Object.keys(LEAD_STATUS_LABEL) as LeadStatus[]

/** Máximo de cartões carregados por coluna (o total real vem em `totais`). */
export const KANBAN_LIMITE_POR_COLUNA = 100

export type KanbanLead = {
  id: string
  nome: string
  telefone: string
  produto: string
  marca: string
  status: LeadStatus
  campanhasNomes: string[]
  atualizadoEm: string
}

/** Campanha que pode receber um lead arrastado para "Em campanha". */
export type KanbanCampanha = {
  id: string
  nome: string
  tipo: CampaignTipo
  status: CampaignStatus
}

export type KanbanBoardData = {
  leads: KanbanLead[]
  campanhas: KanbanCampanha[]
  totais: Record<LeadStatus, number>
  limitePorColuna: number
}

export async function getKanbanBoard(): Promise<KanbanBoardData> {
  const [contagens, campanhas, porColuna] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
    // Campanhas encerradas não recebem leads novos.
    prisma.campaign.findMany({
      where: { status: { not: "encerrada" } },
      select: { id: true, nome: true, tipo: true, status: true },
      orderBy: { criadoEm: "desc" },
    }),
    Promise.all(
      KANBAN_COLUNAS.map((status) =>
        prisma.lead.findMany({
          where: { status },
          select: {
            id: true,
            nome: true,
            telefone: true,
            produto: true,
            marca: true,
            status: true,
            atualizadoEm: true,
            campanha: { select: { nome: true } },
            campanhas: { select: { campanha: { select: { nome: true } } } },
          },
          orderBy: { atualizadoEm: "desc" },
          take: KANBAN_LIMITE_POR_COLUNA,
        }),
      ),
    ),
  ])

  const totais = Object.fromEntries(KANBAN_COLUNAS.map((status) => [status, 0])) as Record<LeadStatus, number>
  for (const linha of contagens) totais[linha.status] = linha._count._all

  const leads: KanbanLead[] = porColuna.flat().map((lead) => ({
    id: lead.id,
    nome: lead.nome,
    telefone: lead.telefone,
    produto: lead.produto,
    marca: lead.marca,
    status: lead.status,
    campanhasNomes: [
      ...new Set(
        [lead.campanha?.nome, ...lead.campanhas.map((vinculo) => vinculo.campanha.nome)].filter(
          (nome): nome is string => Boolean(nome),
        ),
      ),
    ],
    atualizadoEm: lead.atualizadoEm.toISOString(),
  }))

  return { leads, campanhas, totais, limitePorColuna: KANBAN_LIMITE_POR_COLUNA }
}
