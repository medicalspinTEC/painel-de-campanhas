"use client"

import { useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { ChevronRight, Columns3, MessageCircle, Puzzle } from "lucide-react"
import { toast } from "sonner"

import { setChatPluginAtivoAction, setKanbanPluginAtivoAction } from "@/app/actions/settings"
import { LinkButton } from "@/components/shared/link-button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"

type PluginId = "chat" | "kanban"

function PluginCard({
  titulo,
  ativo,
  icon: Icon,
  onClick,
}: {
  titulo: string
  ativo: boolean
  icon: typeof Puzzle
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className="flex min-h-20 w-full max-w-sm items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 text-left text-card-foreground ring-1 ring-foreground/10 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm font-medium">{titulo}</span>
          <Badge variant={ativo ? "default" : "secondary"} className="w-fit">
            {ativo ? "Ativo" : "Desativado"}
          </Badge>
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

type PluginDetails = {
  id: PluginId
  titulo: string
  descricao: string
  ativo: boolean
  onChange: (ativo: boolean) => void
  icon: typeof Puzzle
  href: string
  acaoLabel: string
  acaoIcon: ReactNode
}

export function PluginsManager({
  chatAtivoInicial,
  kanbanAtivoInicial,
}: {
  chatAtivoInicial: boolean
  kanbanAtivoInicial: boolean
}) {
  const router = useRouter()
  const [chatAtivo, setChatAtivo] = useState(chatAtivoInicial)
  const [kanbanAtivo, setKanbanAtivo] = useState(kanbanAtivoInicial)
  const [pending, startTransition] = useTransition()
  const [pluginSelecionado, setPluginSelecionado] = useState<PluginId | null>(null)

  function alterarChat(ativo: boolean) {
    startTransition(async () => {
      const resultado = await setChatPluginAtivoAction(ativo)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }

      setChatAtivo(ativo)
      toast.success(resultado.message)
      router.refresh()
    })
  }

  function alterarKanban(ativo: boolean) {
    startTransition(async () => {
      const resultado = await setKanbanPluginAtivoAction(ativo)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }

      setKanbanAtivo(ativo)
      toast.success(resultado.message)
      router.refresh()
    })
  }

  const detalhes: PluginDetails | null =
    pluginSelecionado === "chat"
      ? {
          id: "chat",
          titulo: "Chat",
          descricao: "Caixa de entrada para consultar conversas e responder aos leads cadastrados.",
          ativo: chatAtivo,
          onChange: alterarChat,
          icon: MessageCircle,
          href: "/chat",
          acaoLabel: "Abrir Chat",
          acaoIcon: <MessageCircle className="size-4" />,
        }
      : pluginSelecionado === "kanban"
        ? {
            id: "kanban",
            titulo: "Kanban",
            descricao: "Quadro que organiza os leads em colunas por status. Arraste o cartão para mudar o status.",
            ativo: kanbanAtivo,
            onChange: alterarKanban,
            icon: Columns3,
            href: "/kanban",
            acaoLabel: "Abrir Kanban",
            acaoIcon: <Columns3 className="size-4" />,
          }
        : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">Plugins disponíveis</h2>
        <p className="text-sm text-muted-foreground">Ative os recursos opcionais que devem aparecer no painel.</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <PluginCard
          titulo="Chat"
          ativo={chatAtivo}
          icon={MessageCircle}
          onClick={() => setPluginSelecionado("chat")}
        />
        <PluginCard
          titulo="Kanban"
          ativo={kanbanAtivo}
          icon={Columns3}
          onClick={() => setPluginSelecionado("kanban")}
        />
      </div>

      <Dialog open={pluginSelecionado !== null} onOpenChange={(open) => !open && setPluginSelecionado(null)}>
        <DialogContent className="sm:max-w-md">
          {detalhes ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <detalhes.icon className="size-4 text-primary" />
                  {detalhes.titulo}
                </DialogTitle>
                <DialogDescription>{detalhes.descricao}</DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Ativar plugin</span>
                  <span className="text-xs text-muted-foreground">
                    {detalhes.ativo ? "Disponível no painel." : "Oculto no painel enquanto estiver desativado."}
                  </span>
                </div>
                <Switch
                  id={`plugin-${detalhes.id}`}
                  aria-label={`Ativar plugin ${detalhes.titulo}`}
                  checked={detalhes.ativo}
                  onCheckedChange={detalhes.onChange}
                  disabled={pending}
                />
              </div>
              {detalhes.ativo ? (
                <LinkButton href={detalhes.href} size="sm" className="w-fit">
                  {detalhes.acaoIcon}
                  {detalhes.acaoLabel}
                </LinkButton>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
