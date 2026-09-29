import { notFound } from "next/navigation"

import { ChatInbox } from "@/components/features/chat/chat-inbox"
import { listInstanceOptions } from "@/services/evolution"
import { getChatInbox } from "@/services/chat"
import { getChatPluginAtivo } from "@/services/settings"

export default async function ChatPage() {
  if (!(await getChatPluginAtivo())) notFound()

  const [inbox, instancias] = await Promise.all([getChatInbox(), listInstanceOptions()])

  return <ChatInbox inicial={inbox} instancias={instancias} />
}
