"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { recordAppLog } from "@/services/app-logs"
import { assignCampaignBulk, setLeadStatus } from "@/services/leads"
import { getKanbanPluginAtivo } from "@/services/settings"
import { LEAD_STATUS_LABEL, type LeadStatus } from "@/types"
import { assertSecao } from "@/lib/session"

const MAX_MENSAGEM_INDIVIDUAL = 4096
const MAX_RESPOSTA_LEAD = 4096

export type MoverKanbanOpcoes = {
  /** Obrigatória ao mover para "Em campanha": campanha em que o lead vai entrar. */
  campanhaId?: string | null
  /** Texto do lead, exigido só quando a campanha é do tipo individual. */
  mensagemIndividual?: string | null
  /** Ao mover para "Respondeu": o que o lead respondeu (opcional, vai para o histórico). */
  resposta?: string | null
}

/**
 * Move um lead para outra coluna do kanban. Reaproveita as mesmas regras da aba
 * Leads (`setLeadStatus` e `assignCampaignBulk`), então timeline, webhooks e
 * saída/entrada de campanha se comportam igual — o kanban não cria um caminho
 * paralelo.
 */
export async function moveKanbanLeadAction(leadId: string, status: LeadStatus, opcoes: MoverKanbanOpcoes = {}) {
  await assertSecao("kanban")
  if (!leadId || !Object.hasOwn(LEAD_STATUS_LABEL, status)) {
    return { ok: false, message: "Status inválido." }
  }
  if (!(await getKanbanPluginAtivo())) {
    return { ok: false, message: "O plugin Kanban está desativado." }
  }

  try {
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
        if (mensagem.length > MAX_MENSAGEM_INDIVIDUAL) {
          return { ok: false, message: `A mensagem é muito longa (máximo de ${MAX_MENSAGEM_INDIVIDUAL} caracteres).` }
        }
      }

      const { atualizados, bloqueados } = await assignCampaignBulk([leadId], campanhaId, campanha.tipo === "individual" ? mensagem : null)
      if (bloqueados > 0 && atualizados === 0) return { ok: false, message: "Lead com status “Não contatar” não pode ser vinculado a campanhas. Mude o status antes." }
      if (atualizados === 0) return { ok: false, message: "Lead não encontrado." }

      // Quem já respondeu continua "respondeu" após a vinculação (regra de
      // `statusAoVincularCampanha`). Aqui a equipe pediu a mudança de forma
      // explícita, então reabrimos o lead como "em campanha".
      const atual = await prisma.lead.findUnique({ where: { id: leadId }, select: { status: true } })
      if (atual && atual.status !== "em_campanha") await setLeadStatus(leadId, "em_campanha")

      revalidarTelas(leadId)
      return { ok: true, message: `Lead movido para ${campanha.nome}.` }
    }

    const resposta = status === "respondeu" ? opcoes.resposta?.trim() || null : null
    if (resposta && resposta.length > MAX_RESPOSTA_LEAD) {
      return { ok: false, message: `A resposta é muito longa (máximo de ${MAX_RESPOSTA_LEAD} caracteres).` }
    }

    const lead = await setLeadStatus(leadId, status, resposta)
    if (!lead) return { ok: false, message: "Lead não encontrado." }
  } catch (error) {
    await recordAppLog({
      origem: "leads",
      mensagem: `Falha ao mover o lead id=${leadId} para "${status}" no kanban.`,
      detalhes: error,
    })
    return { ok: false, message: "Não foi possível mover o lead." }
  }

  revalidarTelas(leadId)
  return { ok: true, message: `Lead movido para ${LEAD_STATUS_LABEL[status]}.` }
}

// O próprio quadro já está atualizado no cliente; /kanban fica de fora
// para não recarregar a tela no meio de outro arrasto.
function revalidarTelas(leadId: string) {
  revalidatePath("/leads")
  revalidatePath(`/leads/${leadId}`)
  revalidatePath("/campanhas")
  revalidatePath("/dashboard")
  revalidatePath("/eventos")
  revalidatePath("/relatorios")
}
