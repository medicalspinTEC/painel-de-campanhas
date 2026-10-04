import { notFound } from "next/navigation"

import { ChatInbox } from "@/components/features/chat/chat-inbox"
import { listInstanceOptions } from "@/services/evolution"
import { getChatInbox } from "@/services/chat"
import { getChatPluginAtivo } from "@/services/settings"
import { requireSecao } from "@/lib/session"

export default async function ChatPage() {
  await requireSecao("chat")
  if (!(await getChatPluginAtivo())) notFound()

  const [inbox, instancias] = await Promise.all([getChatInbox(), listInstanceOptions()])

  return <ChatInbox inicial={inbox} instancias={instancias} />
}
