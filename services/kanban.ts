import { prisma } from "@/lib/prisma"
import { assignCampaignBulk, setLeadStatus } from "@/services/leads"
import { getCrmPluginAtivo } from "@/services/settings"
import { LEAD_STATUS_LABEL, LEAD_STATUS_SOMENTE_CRM, statusDisponiveis, type CampaignStatus, type CampaignTipo, type LeadStatus } from "@/types"

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
  /** Colunas exibidas, na ordem: os status exclusivos do plugin CRM só aparecem com ele ativo. */
  colunas: LeadStatus[]
  limitePorColuna: number
}

export async function getKanbanBoard(): Promise<KanbanBoardData> {
  const colunas = statusDisponiveis(await getCrmPluginAtivo().catch(() => false))
  const [contagens, campanhas, porColuna] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
    // Campanhas encerradas não recebem leads novos.
    prisma.campaign.findMany({
      where: { status: { not: "encerrada" } },
      select: { id: true, nome: true, tipo: true, status: true },
      orderBy: { criadoEm: "desc" },
    }),
    Promise.all(
      colunas.map((status) =>
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

  return { leads, campanhas, totais, colunas, limitePorColuna: KANBAN_LIMITE_POR_COLUNA }
}

const KANBAN_MAX_MENSAGEM_INDIVIDUAL = 4096
const KANBAN_MAX_RESPOSTA_LEAD = 4096

export type MoverKanbanOpcoes = {
  /** Obrigatória ao mover para "Em campanha": campanha em que o lead vai entrar. */
  campanhaId?: string | null
  /** Texto do lead, exigido só quando a campanha é do tipo individual. */
  mensagemIndividual?: string | null
  /** Ao mover para "Respondeu": o que o lead respondeu (opcional, vai para o histórico). */
  resposta?: string | null
}

/**
 * Move um lead de coluna do kanban, sem sessão (usado pelo MCP). Aplica as MESMAS regras de
 * `moveKanbanLeadAction` (app/actions/kanban.ts): reaproveita `setLeadStatus` e
 * `assignCampaignBulk`, então timeline, webhooks e entrada/saída de campanha se comportam igual.
 * Quem chama garante antes que o plugin Kanban está ativo.
 */
export async function moverLeadKanban(
  leadId: string,
  status: LeadStatus,
  opcoes: MoverKanbanOpcoes = {},
): Promise<{ ok: boolean; message: string }> {
  if (!leadId || !Object.hasOwn(LEAD_STATUS_LABEL, status)) return { ok: false, message: "Status inválido." }
  if (LEAD_STATUS_SOMENTE_CRM.includes(status) && !(await getCrmPluginAtivo().catch(() => false))) {
    return { ok: false, message: `O status “${LEAD_STATUS_LABEL[status]}” só existe com o plugin CRM ativo.` }
  }

  if (status === "em_campanha") {
    const campanhaId = opcoes.campanhaId?.trim()
    if (!campanhaId) return { ok: false, message: "Selecione a campanha em que o lead vai entrar." }

    const campanha = await prisma.campaign.findUnique({
      where: { id: campanhaId },
      select: { nome: true, tipo: true, status: true },
    })
    if (!campanha) return { ok: false, message: "Campanha não encontrada." }
    if (campanha.status === "encerrada") return { ok: false, message: "A campanha selecionada está encerrada." }

    const mensagem = opcoes.mensagemIndividual?.trim() || null
    if (campanha.tipo === "individual") {
      if (!mensagem || mensagem.length < 10) {
        return { ok: false, message: "Escreva uma mensagem com pelo menos 10 caracteres para a campanha individual." }
      }
      if (mensagem.length > KANBAN_MAX_MENSAGEM_INDIVIDUAL) {
        return { ok: false, message: `A mensagem é muito longa (máximo de ${KANBAN_MAX_MENSAGEM_INDIVIDUAL} caracteres).` }
      }
    }

    const { atualizados, bloqueados } = await assignCampaignBulk([leadId], campanhaId, campanha.tipo === "individual" ? mensagem : null)
    if (bloqueados > 0 && atualizados === 0) return { ok: false, message: "Lead com status “Não contatar” não pode ser vinculado a campanhas. Mude o status antes." }
    if (atualizados === 0) return { ok: false, message: "Lead não encontrado." }

    // Quem já respondeu continua "respondeu" após a vinculação; aqui a mudança é explícita.
    const atual = await prisma.lead.findUnique({ where: { id: leadId }, select: { status: true } })
    if (atual && atual.status !== "em_campanha") await setLeadStatus(leadId, "em_campanha")
    return { ok: true, message: `Lead movido para ${campanha.nome}.` }
  }

  const resposta = status === "respondeu" ? opcoes.resposta?.trim() || null : null
  if (resposta && resposta.length > KANBAN_MAX_RESPOSTA_LEAD) {
    return { ok: false, message: `A resposta é muito longa (máximo de ${KANBAN_MAX_RESPOSTA_LEAD} caracteres).` }
  }
  const lead = await setLeadStatus(leadId, status, resposta)
  if (!lead) return { ok: false, message: "Lead não encontrado." }
  return { ok: true, message: `Lead movido para ${LEAD_STATUS_LABEL[status]}.` }
}
