import { notFound } from "next/navigation"

import { ChatInbox } from "@/components/features/chat/chat-inbox"
import { listInstanceOptions } from "@/services/evolution"
import { getChatInbox } from "@/services/chat"
import { getCrmChatOpcoes } from "@/services/crm"
import { getChatPluginAtivo, getCrmPluginAtivo } from "@/services/settings"
import { requireSecao } from "@/lib/session"

export default async function ChatPage() {
  const usuario = await requireSecao("chat")
  if (!(await getChatPluginAtivo())) notFound()

  const crmAtivo = await getCrmPluginAtivo()

  const [inbox, instancias, crm] = await Promise.all([
    getChatInbox(),
    listInstanceOptions(),
    // Com o CRM ativo o chat ganha a transferência por departamento e atendente.
    crmAtivo ? getCrmChatOpcoes(usuario.id, usuario.role !== "padrao") : Promise.resolve(null),
  ])

  return (
    <ChatInbox
      inicial={inbox}
      instancias={instancias}
      nomeUsuario={usuario.nome}
      identificarRemetenteInicial={usuario.chatIdentificarRemetente}
      crm={crm}
    />
  )
}
