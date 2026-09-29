"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { MessageCircle, Puzzle } from "lucide-react"
import { toast } from "sonner"

import { setChatPluginAtivoAction } from "@/app/actions/settings"
import { LinkButton } from "@/components/shared/link-button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"

export function PluginsManager({ chatAtivoInicial }: { chatAtivoInicial: boolean }) {
  const router = useRouter()
  const [chatAtivo, setChatAtivo] = useState(chatAtivoInicial)
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">Plugins disponíveis</h2>
        <p className="text-sm text-muted-foreground">Ative os recursos opcionais que devem aparecer no painel.</p>
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Puzzle className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <CardTitle className="flex items-center gap-2 text-base">
                Chat
                <Badge variant={chatAtivo ? "default" : "secondary"}>{chatAtivo ? "Ativo" : "Desativado"}</Badge>
              </CardTitle>
              <CardDescription>
                Caixa de entrada para consultar conversas e responder aos leads cadastrados.
              </CardDescription>
            </div>
          </div>
          <Switch
            id="plugin-chat"
            aria-label="Ativar plugin Chat"
            checked={chatAtivo}
            onCheckedChange={alterarChat}
            disabled={pending}
          />
        </CardHeader>
        {chatAtivo ? (
          <CardContent className="border-t pt-4">
            <LinkButton href="/chat" size="sm">
              <MessageCircle className="size-4" />
              Abrir Chat
            </LinkButton>
          </CardContent>
        ) : null}
      </Card>
    </div>
  )
}
