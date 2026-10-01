"use server"

import { addChatInternalNote, getChatInbox, getChatMessages } from "@/services/chat"

export async function refreshChatInboxAction(conversaId?: string | null, semMensagens = false) {
  return getChatInbox(conversaId, { semMensagens })
}

/** Só o histórico de uma conversa: abrir um lead não precisa recarregar a lista inteira. */
export async function loadChatMessagesAction(leadId: string) {
  return getChatMessages(leadId)
}

export async function createChatInternalNoteAction(leadId: string, texto: string) {
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
