"use server"

import { getChatInbox } from "@/services/chat"

export async function refreshChatInboxAction(conversaId?: string | null) {
  return getChatInbox(conversaId)
}
