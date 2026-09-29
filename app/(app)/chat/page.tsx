import { ChatInbox } from "@/components/features/chat/chat-inbox"
import { listInstanceOptions } from "@/services/evolution"
import { getChatInbox } from "@/services/chat"

export default async function ChatPage() {
  const [inbox, instancias] = await Promise.all([getChatInbox(), listInstanceOptions()])

  return <ChatInbox inicial={inbox} instancias={instancias} />
}
