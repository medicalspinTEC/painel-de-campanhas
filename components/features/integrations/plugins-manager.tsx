"use client"

import { useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Columns3, MessageCircle, Puzzle } from "lucide-react"
import { toast } from "sonner"

import { setChatPluginAtivoAction, setKanbanPluginAtivoAction } from "@/app/actions/settings"
import { LinkButton } from "@/components/shared/link-button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"

type PluginCardProps = {
  id: string
  titulo: string
  descricao: string
  ativo: boolean
  desabilitado: boolean
  onChange: (ativo: boolean) => void
  acao: ReactNode
}

function PluginCard({ id, titulo, descricao, ativo, desabilitado, onChange, acao }: PluginCardProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Puzzle className="size-5" />
          </span>
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              {titulo}
              <Badge variant={ativo ? "default" : "secondary"}>{ativo ? "Ativo" : "Desativado"}</Badge>
            </CardTitle>
            <CardDescription>{descricao}</CardDescription>
          </div>
        </div>
        <Switch
          id={id}
          aria-label={`Ativar plugin ${titulo}`}
          checked={ativo}
          onCheckedChange={onChange}
          disabled={desabilitado}
        />
      </CardHeader>
      {ativo ? <CardContent className="border-t pt-4">{acao}</CardContent> : null}
    </Card>
  )
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">Plugins disponíveis</h2>
        <p className="text-sm text-muted-foreground">Ative os recursos opcionais que devem aparecer no painel.</p>
      </div>

      <PluginCard
        id="plugin-chat"
        titulo="Chat"
        descricao="Caixa de entrada para consultar conversas e responder aos leads cadastrados."
        ativo={chatAtivo}
        desabilitado={pending}
        onChange={alterarChat}
        acao={
          <LinkButton href="/chat" size="sm">
            <MessageCircle className="size-4" />
            Abrir Chat
          </LinkButton>
        }
      />

      <PluginCard
        id="plugin-kanban"
        titulo="Kanban"
        descricao="Quadro que organiza os leads em colunas por status. Arraste o cartão para mudar o status."
        ativo={kanbanAtivo}
        desabilitado={pending}
        onChange={alterarKanban}
        acao={
          <LinkButton href="/kanban" size="sm">
            <Columns3 className="size-4" />
            Abrir Kanban
          </LinkButton>
        }
      />
    </div>
  )
}
