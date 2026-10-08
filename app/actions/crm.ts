"use server"

import { revalidatePath } from "next/cache"

import { PluginDesativadoError } from "@/lib/plugins"
import { assertPoder, assertSecao, ForbiddenError } from "@/lib/session"
import { AgenteIaError, definirAgenteDeEntrada, vincularAgenteAoDepartamento } from "@/services/agentes-ia"
import { recordAppLog } from "@/services/app-logs"
import { enviarLeadParaCampanhaPeloChat } from "@/services/lead-campanha"
import { ativarBotDoCrm, criarBotDoCrm, excluirBotDoCrm } from "@/services/bots"
import {
  alternarBotConversa,
  createAtendente,
  createDepartamento,
  assumirConversa,
  CrmError,
  deleteAtendente,
  deleteDepartamento,
  setAtendenteAtivo,
  setDepartamentoAtivo,
  transferirConversa,
  updateAtendente,
  updateDepartamento,
  type AtendenteInput,
  type DepartamentoInput,
  type TransferenciaInput,
} from "@/services/crm"
import {
  ativarFollowUpBot,
  criarFollowUpBot,
  excluirFollowUpBot,
  excluirFollowUpTemplate,
  salvarFollowUpBot,
  salvarFollowUpTemplate,
  type FollowUpBotInput,
  type FollowUpTemplateInput,
} from "@/services/followup"
import { getChatPluginAtivo, getCrmPluginAtivo } from "@/services/settings"
import { UserError } from "@/services/users"

export type CrmActionResult = { ok: boolean; message: string }

function falha(error: unknown, contexto: string): CrmActionResult {
  if (
    error instanceof CrmError ||
    error instanceof AgenteIaError ||
    error instanceof UserError ||
    error instanceof ForbiddenError ||
    error instanceof PluginDesativadoError
  ) {
    return { ok: false, message: error.message }
  }
  void recordAppLog({ origem: "crm", mensagem: contexto, detalhes: error })
  return { ok: false, message: contexto }
}

/** Gestão do CRM: root ou admin com o poder "Gerenciar o CRM", e só com o plugin ativo. */
async function exigirGestaoCrm() {
  const usuario = await assertPoder("crm_gerenciar")
  if (!(await getCrmPluginAtivo())) throw new CrmError("O plugin CRM está desativado.")
  return usuario
}

function revalidarCrm() {
  revalidatePath("/crm")
  revalidatePath("/usuarios")
  revalidatePath("/chat")
  revalidatePath("/", "layout")
}

// ---------------------------------------------------------------------------
// Departamentos
// ---------------------------------------------------------------------------

export async function createDepartamentoAction(input: DepartamentoInput): Promise<CrmActionResult> {
  try {
    await exigirGestaoCrm()
    await createDepartamento(input)
  } catch (error) {
    return falha(error, "Não foi possível criar o departamento.")
  }
  revalidarCrm()
  return { ok: true, message: "Departamento criado." }
}

export async function updateDepartamentoAction(id: string, input: DepartamentoInput): Promise<CrmActionResult> {
  try {
    await exigirGestaoCrm()
    await updateDepartamento(id, input)
  } catch (error) {
    return falha(error, "Não foi possível salvar o departamento.")
  }
  revalidarCrm()
  return { ok: true, message: "Departamento atualizado." }
}

export async function setDepartamentoAtivoAction(id: string, ativo: boolean): Promise<CrmActionResult> {
  try {
    await exigirGestaoCrm()
    if (typeof ativo !== "boolean") return { ok: false, message: "Estado inválido." }
    await setDepartamentoAtivo(id, ativo)
  } catch (error) {
    return falha(error, "Não foi possível alterar o departamento.")
  }
  revalidarCrm()
  return { ok: true, message: ativo ? "Departamento ativado." : "Departamento inativado." }
}

/** Vincula (ou, com `null`, desvincula) o agente de IA que atende um departamento. */
export async function setDepartamentoAgenteIaAction(departamentoId: string, agenteId: string | null): Promise<CrmActionResult> {
  try {
    await exigirGestaoCrm()
    await vincularAgenteAoDepartamento(departamentoId, agenteId)
  } catch (error) {
    return falha(error, "Não foi possível vincular o agente de IA ao departamento.")
  }
  revalidarCrm()
  return { ok: true, message: agenteId ? "Agente de IA vinculado ao departamento." : "Agente de IA removido do departamento." }
}

/** Define (ou, com `null`, remove) o agente de IA de entrada. */
export async function setAgenteIaEntradaAction(agenteId: string | null): Promise<CrmActionResult> {
  try {
    await exigirGestaoCrm()
    await definirAgenteDeEntrada(agenteId)
  } catch (error) {
    return falha(error, "Não foi possível definir o agente de IA de entrada.")
  }
  revalidarCrm()
  return { ok: true, message: agenteId ? "Agente de IA de entrada definido." : "Agente de IA de entrada removido." }
}

export async function deleteDepartamentoAction(id: string): Promise<CrmActionResult> {
  try {
    await exigirGestaoCrm()
    const { conversas } = await deleteDepartamento(id)
    revalidarCrm()
    return {
      ok: true,
      message:
        conversas > 0
          ? `Departamento excluído. ${conversas} ${conversas === 1 ? "conversa ficou" : "conversas ficaram"} sem departamento.`
          : "Departamento excluído.",
    }
  } catch (error) {
    return falha(error, "Não foi possível excluir o departamento.")
  }
}

// ---------------------------------------------------------------------------
// Atendentes
// ---------------------------------------------------------------------------

export async function createAtendenteAction(input: AtendenteInput): Promise<CrmActionResult> {
  try {
    const ator = await exigirGestaoCrm()
    await createAtendente(input, ator)
  } catch (error) {
    return falha(error, "Não foi possível criar o atendente.")
  }
  revalidarCrm()
  return { ok: true, message: "Atendente criado." }
}

export async function updateAtendenteAction(id: string, input: AtendenteInput): Promise<CrmActionResult> {
  try {
    const ator = await exigirGestaoCrm()
    await updateAtendente(id, input, ator)
  } catch (error) {
    return falha(error, "Não foi possível salvar o atendente.")
  }
  revalidarCrm()
  return { ok: true, message: "Atendente atualizado." }
}

export async function setAtendenteAtivoAction(id: string, ativo: boolean): Promise<CrmActionResult> {
  try {
    await exigirGestaoCrm()
    if (typeof ativo !== "boolean") return { ok: false, message: "Estado inválido." }
    await setAtendenteAtivo(id, ativo)
  } catch (error) {
    return falha(error, "Não foi possível alterar o atendente.")
  }
  revalidarCrm()
  return { ok: true, message: ativo ? "Atendente ativado." : "Atendente inativado." }
}

export async function deleteAtendenteAction(id: string, excluirUsuario = false): Promise<CrmActionResult> {
  try {
    const ator = await exigirGestaoCrm()
    await deleteAtendente(id, ator, Boolean(excluirUsuario))
  } catch (error) {
    return falha(error, "Não foi possível excluir o atendente.")
  }
  revalidarCrm()
  return { ok: true, message: excluirUsuario ? "Atendente e usuário excluídos." : "Atendente excluído." }
}

// ---------------------------------------------------------------------------
// Chat: transferência de conversas
// ---------------------------------------------------------------------------

/**
 * Transfere a conversa de um lead. Disponível para quem acessa o Chat (não só
 * admin) e só quando os plugins Chat e CRM estão ativos.
 */
export async function transferirConversaAction(leadId: string, input: TransferenciaInput): Promise<CrmActionResult> {
  try {
    const usuario = await assertSecao("chat")
    const [chatAtivo, crmAtivo] = await Promise.all([getChatPluginAtivo(), getCrmPluginAtivo()])
    if (!chatAtivo || !crmAtivo) throw new CrmError("A transferência exige os plugins Chat e CRM ativos.")

    const id = String(leadId ?? "").trim()
    if (!id) throw new CrmError("Selecione uma conversa para transferir.")

    const { para } = await transferirConversa(id, input, { id: usuario.id, nome: usuario.nome, role: usuario.role })
    revalidatePath("/chat")
    const semVinculo = !input.departamentoId && !input.atendenteId
    return {
      ok: true,
      message: semVinculo ? "Vínculo removido: a conversa está sem departamento e sem atendente." : `Conversa transferida para ${para}.`,
    }
  } catch (error) {
    return falha(error, "Não foi possível transferir a conversa.")
  }
}

/**
 * Envia o lead da conversa para uma campanha, direto do chat. Disponível para quem acessa o
 * Chat e só com os plugins Chat e CRM ativos; segue as regras de atendimento da conversa.
 */
export async function enviarLeadParaCampanhaAction(
  leadId: string,
  campanhaId: string,
  mensagemIndividual?: string | null,
): Promise<CrmActionResult> {
  try {
    const usuario = await assertSecao("chat")
    const [chatAtivo, crmAtivo] = await Promise.all([getChatPluginAtivo(), getCrmPluginAtivo()])
    if (!chatAtivo || !crmAtivo) throw new CrmError("Enviar para campanha exige os plugins Chat e CRM ativos.")

    const id = String(leadId ?? "").trim()
    if (!id) throw new CrmError("Selecione uma conversa.")

    const r = await enviarLeadParaCampanhaPeloChat(id, String(campanhaId ?? ""), mensagemIndividual, {
      id: usuario.id,
      nome: usuario.nome,
      role: usuario.role,
    })
    revalidatePath("/chat")
    revalidatePath("/leads")
    revalidatePath("/campanhas")
    return {
      ok: true,
      message: r.aguardaAtivacao
        ? `${r.leadNome} entrou na campanha “${r.campanhaNome}”, que está ${r.campanhaStatus}: as mensagens só saem quando ela for ativada.`
        : `${r.leadNome} foi enviado para a campanha “${r.campanhaNome}”.`,
    }
  } catch (error) {
    return falha(error, "Não foi possível enviar o lead para a campanha.")
  }
}

/** Assume uma conversa que está num departamento sem atendente responsável. */
export async function assumirConversaAction(leadId: string): Promise<CrmActionResult> {
  try {
    const usuario = await assertSecao("chat")
    const [chatAtivo, crmAtivo] = await Promise.all([getChatPluginAtivo(), getCrmPluginAtivo()])
    if (!chatAtivo || !crmAtivo) throw new CrmError("Assumir conversas exige os plugins Chat e CRM ativos.")

    const id = String(leadId ?? "").trim()
    if (!id) throw new CrmError("Selecione uma conversa para assumir.")

    await assumirConversa(id, { id: usuario.id, nome: usuario.nome, role: usuario.role })
    revalidatePath("/chat")
    return { ok: true, message: "Você assumiu a conversa." }
  } catch (error) {
    return falha(error, "Não foi possível assumir a conversa.")
  }
}

// ---------------------------------------------------------------------------
// Bots (fluxos No Code do tipo "bot")
// ---------------------------------------------------------------------------

/** Cria um bot de entrada (`departamentoId` nulo) ou de um departamento e devolve o id para abrir no editor. */
export async function createBotAction(input: {
  nome: string
  departamentoId: string | null
}): Promise<CrmActionResult & { id?: string }> {
  try {
    await exigirGestaoCrm()
    const { id } = await criarBotDoCrm({ nome: input?.nome, departamentoId: input?.departamentoId ?? null })
    revalidarCrm()
    revalidatePath("/nocode")
    return { ok: true, message: "Bot criado. Monte o fluxo no No Code e ative-o quando estiver pronto.", id }
  } catch (error) {
    return falha(error, "Não foi possível criar o bot.")
  }
}

export async function setBotAtivoAction(id: string, ativo: boolean): Promise<CrmActionResult> {
  try {
    await exigirGestaoCrm()
    if (typeof ativo !== "boolean") return { ok: false, message: "Estado inválido." }
    const { desativados } = await ativarBotDoCrm(id, ativo)
    revalidarCrm()
    revalidatePath("/nocode")
    if (!ativo) return { ok: true, message: "Bot desativado." }
    return {
      ok: true,
      message: desativados > 0 ? "Bot ativado. O outro bot ativo deste mesmo escopo foi desativado." : "Bot ativado.",
    }
  } catch (error) {
    return falha(error, "Não foi possível alterar o bot.")
  }
}

export async function deleteBotAction(id: string): Promise<CrmActionResult> {
  try {
    await exigirGestaoCrm()
    await excluirBotDoCrm(id)
    revalidarCrm()
    revalidatePath("/nocode")
    return { ok: true, message: "Bot excluído." }
  } catch (error) {
    return falha(error, "Não foi possível excluir o bot.")
  }
}

/**
 * Liga ou pausa o bot numa conversa específica (botão do chat). Depois que um humano assume, o bot
 * só volta a responder aquela conversa quando alguém o reativa por aqui.
 */
export async function alternarBotConversaAction(leadId: string, ativo: boolean): Promise<CrmActionResult> {
  try {
    const usuario = await assertSecao("chat")
    if (!(await getCrmPluginAtivo())) throw new CrmError("O plugin CRM está desativado.")
    if (typeof ativo !== "boolean" || !String(leadId ?? "").trim()) return { ok: false, message: "Pedido inválido." }
    await alternarBotConversa(leadId, ativo, usuario)
    revalidatePath("/chat")
    return { ok: true, message: ativo ? "Bot reativado nesta conversa." : "Bot pausado nesta conversa." }
  } catch (error) {
    return falha(error, "Não foi possível alterar o bot da conversa.")
  }
}

// ---------------------------------------------------------------------------
// Bot de follow-up do departamento
// ---------------------------------------------------------------------------

export async function createFollowUpBotAction(departamentoId: string, nome?: string): Promise<CrmActionResult & { id?: string }> {
  try {
    await exigirGestaoCrm()
    const { id } = await criarFollowUpBot({ departamentoId, nome })
    revalidarCrm()
    return { ok: true, message: "Bot de follow-up criado. Cadastre os templates e ligue o bot.", id }
  } catch (error) {
    return falha(error, "Não foi possível criar o bot de follow-up.")
  }
}

export async function saveFollowUpBotAction(id: string, input: FollowUpBotInput): Promise<CrmActionResult> {
  try {
    await exigirGestaoCrm()
    await salvarFollowUpBot(id, input)
    revalidarCrm()
    return { ok: true, message: "Configurações do follow-up salvas." }
  } catch (error) {
    return falha(error, "Não foi possível salvar o bot de follow-up.")
  }
}

export async function setFollowUpBotAtivoAction(id: string, ativo: boolean): Promise<CrmActionResult> {
  try {
    await exigirGestaoCrm()
    await ativarFollowUpBot(id, ativo)
    revalidarCrm()
    return {
      ok: true,
      message: ativo
        ? "Bot de follow-up ligado. Ele vale para mensagens enviadas a partir de agora."
        : "Bot de follow-up desligado.",
    }
  } catch (error) {
    return falha(error, "Não foi possível alterar o bot de follow-up.")
  }
}

export async function deleteFollowUpBotAction(id: string): Promise<CrmActionResult> {
  try {
    await exigirGestaoCrm()
    await excluirFollowUpBot(id)
    revalidarCrm()
    return { ok: true, message: "Bot de follow-up excluído." }
  } catch (error) {
    return falha(error, "Não foi possível excluir o bot de follow-up.")
  }
}

export async function saveFollowUpTemplateAction(botId: string, input: FollowUpTemplateInput): Promise<CrmActionResult> {
  try {
    await exigirGestaoCrm()
    await salvarFollowUpTemplate(botId, input)
    revalidarCrm()
    return { ok: true, message: input.id ? "Template salvo." : "Template criado." }
  } catch (error) {
    return falha(error, "Não foi possível salvar o template.")
  }
}

export async function deleteFollowUpTemplateAction(id: string): Promise<CrmActionResult> {
  try {
    await exigirGestaoCrm()
    await excluirFollowUpTemplate(id)
    revalidarCrm()
    return { ok: true, message: "Template excluído." }
  } catch (error) {
    return falha(error, "Não foi possível excluir o template.")
  }
}
