"use server"

import { addChatInternalNote, getChatInbox, getChatMessages, getChatsForExport } from "@/services/chat"
import { assertSecao } from "@/lib/session"

export async function refreshChatInboxAction(conversaId?: string | null, semMensagens = false) {
  await assertSecao("chat")
  return getChatInbox(conversaId, { semMensagens })
}

/** Só o histórico de uma conversa: abrir um lead não precisa recarregar a lista inteira. */
export async function loadChatMessagesAction(leadId: string) {
  await assertSecao("chat")
  return getChatMessages(leadId)
}

export async function createChatInternalNoteAction(leadId: string, texto: string) {
  await assertSecao("chat")
  const leadIdLimpo = leadId.trim()
  const textoLimpo = texto.trim()

  if (!leadIdLimpo) return { ok: false, message: "Selecione um lead para adicionar a nota." }
  if (!textoLimpo) return { ok: false, message: "Escreva uma nota antes de salvar." }
  if (textoLimpo.length > 5000) {
    return { ok: false, message: "A nota é muito longa (máximo de 5000 caracteres)." }
  }

  try {
    await addChatInternalNote(leadIdLimpo, textoLimpo)
    return { ok: true, message: "Nota interna adicionada." }
  } catch {
    return { ok: false, message: "Não foi possível salvar a nota interna." }
  }
}

/** Dados para exportar conversas (PDF/JSON). Sem `leadIds`, exporta todas. */
export async function exportChatsAction(leadIds?: string[] | null) {
  await assertSecao("chat")
  try {
    return { ok: true as const, conversas: await getChatsForExport(leadIds) }
  } catch {
    return { ok: false as const, message: "Não foi possível carregar as conversas para exportar." }
  }
}
