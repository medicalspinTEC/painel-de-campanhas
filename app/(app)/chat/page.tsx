import { notFound } from "next/navigation"

import { ChatAbas } from "@/components/features/chat/chat-abas"
import { ChatInbox } from "@/components/features/chat/chat-inbox"
import { listInstanceOptions } from "@/services/evolution"
import { getChatInbox } from "@/services/chat"
import { listChatTemplates } from "@/services/chat-templates"
import { contarNaoLidasInternas } from "@/services/chat-interno"
import { getCrmChatOpcoes } from "@/services/crm"
import { getChatPluginAtivo, getCrmPluginAtivo } from "@/services/settings"
import { requireSecao } from "@/lib/session"

export default async function ChatPage() {
  const usuario = await requireSecao("chat")
  if (!(await getChatPluginAtivo())) notFound()

  const crmAtivo = await getCrmPluginAtivo()

  const [inbox, instancias, crm, templates, naoLidasEquipe] = await Promise.all([
    getChatInbox(),
    listInstanceOptions(),
    // Com o CRM ativo o chat ganha a transferência por departamento e atendente.
    crmAtivo ? getCrmChatOpcoes(usuario.id, usuario.role !== "padrao") : Promise.resolve(null),
    listChatTemplates(usuario.id),
    // Selo da aba "Equipe". Se o chat interno ainda não foi migrado, não derruba o chat com leads.
    contarNaoLidasInternas(usuario.id).catch(() => 0),
  ])

  return (
    <ChatInbox
      inicial={inbox}
      instancias={instancias}
      nomeUsuario={usuario.nome}
      identificarRemetenteInicial={usuario.chatIdentificarRemetente}
      crm={crm}
      templatesIniciais={templates}
      topo={<ChatAbas ativa="leads" naoLidasEquipe={naoLidasEquipe} />}
    />
  )
}
