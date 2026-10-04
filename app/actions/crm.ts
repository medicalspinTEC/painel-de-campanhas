"use server"

import { revalidatePath } from "next/cache"

import { assertPoder, assertSecao, ForbiddenError } from "@/lib/session"
import { recordAppLog } from "@/services/app-logs"
import {
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
import { getChatPluginAtivo, getCrmPluginAtivo } from "@/services/settings"
import { UserError } from "@/services/users"

export type CrmActionResult = { ok: boolean; message: string }

function falha(error: unknown, contexto: string): CrmActionResult {
  if (error instanceof CrmError || error instanceof UserError || error instanceof ForbiddenError) {
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
    return { ok: true, message: `Conversa transferida para ${para}.` }
  } catch (error) {
    return falha(error, "Não foi possível transferir a conversa.")
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
