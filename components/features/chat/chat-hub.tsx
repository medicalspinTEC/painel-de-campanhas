import { Suspense } from "react"
import { notFound } from "next/navigation"

import { ChatAbas } from "@/components/features/chat/chat-abas"
import { ChatInbox } from "@/components/features/chat/chat-inbox"
import { ChatInterno } from "@/components/features/chat/chat-interno"
import { ChatShell, type AbaChat } from "@/components/features/chat/chat-shell"
import { requireSecao } from "@/lib/session"
import { getChatInbox } from "@/services/chat"
import { listChatTemplates } from "@/services/chat-templates"
import { getInternoSnapshot } from "@/services/chat-interno"
import { getCrmChatOpcoes } from "@/services/crm"
import { listInstanceOptions } from "@/services/evolution"
import { getChatPluginAtivo, getCrmPluginAtivo } from "@/services/settings"

type Usuario = Awaited<ReturnType<typeof requireSecao>>

function ChatCarregando() {
  return (
    <div className="flex h-[calc(100svh-6.5rem)] min-h-176 flex-col gap-3 lg:min-h-144" role="status" aria-label="Carregando o chat">
      <div className="flex gap-1.5">
        <span className="h-7 w-20 animate-pulse rounded-full bg-muted" />
        <span className="h-7 w-24 animate-pulse rounded-full bg-muted" />
      </div>
      <div className="min-h-0 flex-1 animate-pulse rounded-lg border bg-card" />
    </div>
  )
}

async function ChatLeads({ usuario }: { usuario: Usuario }) {
  const crmAtivo = await getCrmPluginAtivo()
  const [inbox, instancias, crm, templates] = await Promise.all([
    getChatInbox(),
    listInstanceOptions(),
    // Com o CRM ativo o chat ganha a transferência por departamento e atendente.
    crmAtivo ? getCrmChatOpcoes(usuario.id, usuario.role !== "padrao") : Promise.resolve(null),
    listChatTemplates(usuario.id),
  ])
  return (
    <ChatInbox
      inicial={inbox}
      instancias={instancias}
      nomeUsuario={usuario.nome}
      identificarRemetenteInicial={usuario.chatIdentificarRemetente}
      crm={crm}
      templatesIniciais={templates}
      topo={<ChatAbas />}
    />
  )
}

async function ChatEquipe({ usuarioId }: { usuarioId: string }) {
  // Se o chat interno ainda não foi migrado, só esta aba falha — o chat com leads segue funcionando.
  const inicial = await getInternoSnapshot(usuarioId, null, { semMensagens: true }).catch(() => null)
  if (!inicial) {
    return (
      <div className="flex flex-col gap-3">
        <ChatAbas />
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Não foi possível carregar o chat da equipe agora.</p>
      </div>
    )
  }
  return <ChatInterno inicial={inicial} usuarioId={usuarioId} />
}

/**
 * Página única do chat. Cada aba busca os próprios dados em paralelo e aparece assim que fica pronta
 * (streaming), sem uma travar a outra. Depois do primeiro carregamento, alternar entre elas é instantâneo.
 */
export async function ChatHub({ abaInicial }: { abaInicial: AbaChat }) {
  const [usuario, pluginAtivo] = await Promise.all([requireSecao("chat"), getChatPluginAtivo()])
  if (!pluginAtivo) notFound()

  return (
    <ChatShell
      abaInicial={abaInicial}
      leads={
        <Suspense fallback={<ChatCarregando />}>
          <ChatLeads usuario={usuario} />
        </Suspense>
      }
      equipe={
        <Suspense fallback={<ChatCarregando />}>
          <ChatEquipe usuarioId={usuario.id} />
        </Suspense>
      }
    />
  )
}
