import { prisma } from "@/lib/prisma"
import { getCampaignSchedule, type CampaignLeadSchedule } from "@/services/campaigns"
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

/**
 * Leads do Kanban por deslocamento (skip/take), sem o limite por coluna do painel. Usado pelo MCP, que
 * pagina em lotes até devolver todos os leads. Com `status`, só aquela coluna; sem, todas as colunas
 * disponíveis (as exclusivas do plugin CRM só com ele ativo).
 */
export async function listKanbanLeadsPaginado(opcoes: {
  status?: LeadStatus
  skip: number
  take: number
}): Promise<{ total: number; leads: KanbanLead[] }> {
  const colunas = statusDisponiveis(await getCrmPluginAtivo().catch(() => false))
  const where = opcoes.status ? { status: opcoes.status } : { status: { in: colunas } }
  const [total, rows] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
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
      orderBy: [{ atualizadoEm: "desc" }, { id: "desc" }],
      skip: opcoes.skip,
      take: opcoes.take,
    }),
  ])
  const leads: KanbanLead[] = rows.map((lead) => ({
    id: lead.id,
    nome: lead.nome,
    telefone: lead.telefone,
    produto: lead.produto,
    marca: lead.marca,
    status: lead.status,
    campanhasNomes: [
      ...new Set(
        [lead.campanha?.nome, ...lead.campanhas.map((vinculo) => vinculo.campanha.nome)].filter((nome): nome is string => Boolean(nome)),
      ),
    ],
    atualizadoEm: lead.atualizadoEm.toISOString(),
  }))
  return { total, leads }
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

// ---------------------------------------------------------------------------
// Kanban da campanha: cada etapa é um ponto da sequência de mensagens
// ---------------------------------------------------------------------------

/** Etapa (coluna) do quadro de uma campanha. `indice` = quantas mensagens do ciclo o lead já recebeu. */
export type KanbanEtapa = {
  indice: number
  titulo: string
  subtitulo: string
}

export type KanbanCampanhaLead = {
  id: string
  nome: string
  telefone: string
  produto: string
  marca: string
  status: LeadStatus
  /** Índice da etapa em que o lead está (coluna). */
  etapa: number
  proximaMensagemEm: string | null
  aguardandoRecorrencia: boolean
}

export type KanbanCampanhaBoardData = {
  campanha: {
    id: string
    nome: string
    tipo: CampaignTipo
    status: CampaignStatus
    recorrenciaDias: number
    totalMensagens: number
  }
  etapas: KanbanEtapa[]
  leads: KanbanCampanhaLead[]
  /** Só campanhas padrão com mensagens permitem mover cartões (envio imediato da próxima mensagem). */
  podeAvancar: boolean
  limitePorColuna: number
}

/**
 * Quadro de gestão de UMA campanha. Reaproveita `getCampaignSchedule` (mesmo núcleo da engine de disparo),
 * então a etapa e o cronômetro de cada cartão batem com a tela de detalhes da campanha.
 *
 *  - Campanha padrão: colunas "Aguardando 1ª mensagem", "Recebeu a mensagem N"… e "Sequência concluída".
 *  - Campanha individual: só "Pendente" e "Enviada" (cada lead recebe uma única mensagem própria).
 */
export async function getKanbanCampanhaBoard(campanhaId: string): Promise<KanbanCampanhaBoardData | null> {
  const campanha = await prisma.campaign.findUnique({
    where: { id: campanhaId },
    select: {
      id: true,
      nome: true,
      tipo: true,
      status: true,
      recorrenciaDias: true,
      mensagens: { select: { dia: true, horario: true }, orderBy: { dia: "asc" } },
    },
  })
  if (!campanha) return null

  const individual = campanha.tipo === "individual"
  const agendaPromise: Promise<Record<string, CampaignLeadSchedule>> = individual
    ? Promise.resolve({})
    : getCampaignSchedule(campanhaId)

  const [vinculos, agenda] = await Promise.all([
    prisma.leadCampaign.findMany({
      where: { campanhaId },
      select: {
        enviadaIndividualEm: true,
        lead: { select: { id: true, nome: true, telefone: true, produto: true, marca: true, status: true } },
      },
    }),
    agendaPromise,
  ])

  const total = campanha.mensagens.length
  const dias = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`

  let etapas: KanbanEtapa[]
  if (individual) {
    etapas = [
      { indice: 0, titulo: "Pendente", subtitulo: "Mensagem individual ainda não enviada" },
      { indice: 1, titulo: "Enviada", subtitulo: "Mensagem individual já enviada" },
    ]
  } else {
    etapas = Array.from({ length: total + 1 }, (_, indice) => {
      if (indice === total) {
        return {
          indice,
          titulo: "Sequência concluída",
          subtitulo: `Aguardando recorrência (${dias(campanha.recorrenciaDias)})`,
        }
      }
      const proxima = campanha.mensagens[indice]
      return {
        indice,
        titulo: indice === 0 ? "Aguardando 1ª mensagem" : `Recebeu a mensagem ${indice}`,
        subtitulo: `Próxima: dia ${proxima.dia} · ${proxima.horario}`,
      }
    })
  }

  const leads: KanbanCampanhaLead[] = vinculos.map((vinculo) => {
    const agendamento = agenda[vinculo.lead.id]
    const etapa = individual
      ? vinculo.enviadaIndividualEm
        ? 1
        : 0
      : Math.min(agendamento?.enviadosNoCiclo ?? 0, total)
    return {
      id: vinculo.lead.id,
      nome: vinculo.lead.nome,
      telefone: vinculo.lead.telefone,
      produto: vinculo.lead.produto,
      marca: vinculo.lead.marca,
      status: vinculo.lead.status,
      etapa,
      proximaMensagemEm: agendamento?.proximaMensagemEm ?? null,
      aguardandoRecorrencia: agendamento?.aguardandoRecorrencia ?? false,
    }
  })

  return {
    campanha: {
      id: campanha.id,
      nome: campanha.nome,
      tipo: campanha.tipo,
      status: campanha.status,
      recorrenciaDias: campanha.recorrenciaDias,
      totalMensagens: total,
    },
    etapas,
    leads,
    podeAvancar: !individual && total > 0,
    limitePorColuna: KANBAN_LIMITE_POR_COLUNA,
  }
}
