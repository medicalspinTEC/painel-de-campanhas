import { notFound } from "next/navigation"

import { ChatInterno } from "@/components/features/chat/chat-interno"
import { requireSecao } from "@/lib/session"
import { getInternoSnapshot } from "@/services/chat-interno"
import { getChatPluginAtivo } from "@/services/settings"

export default async function ChatInternoPage() {
  const usuario = await requireSecao("chat")
  if (!(await getChatPluginAtivo())) notFound()

  const inicial = await getInternoSnapshot(usuario.id, null, { semMensagens: true })

  return <ChatInterno inicial={inicial} usuarioId={usuario.id} />
}
