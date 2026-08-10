"use client"

import { useState, useTransition } from "react"
import { Copy, Eye, EyeOff, Pencil, Plus, Send, Trash2, Webhook as WebhookIcon } from "lucide-react"
import { toast } from "sonner"

import { deleteWebhookAction, testWebhookAction } from "@/app/actions/webhooks"
import { WebhookFormDialog } from "@/components/features/integrations/webhook-form-dialog"
import { formatDateTime } from "@/lib/format"
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABEL, WEBHOOK_LIMITE } from "@/lib/webhook-events"
import type { Webhook } from "@/services/webhooks"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"

export function WebhooksManager({ webhooks }: { webhooks: Webhook[] }) {
  const [dialogAberto, setDialogAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<Webhook | null>(null)
  const [excluindo, setExcluindo] = useState<Webhook | null>(null)
  const [pending, startTransition] = useTransition()

  const restantes = WEBHOOK_LIMITE - webhooks.length
  const limiteAtingido = restantes <= 0

  function abrirNovo() {
    setEmEdicao(null)
    setDialogAberto(true)
  }

  function abrirEdicao(webhook: Webhook) {
    setEmEdicao(webhook)
    setDialogAberto(true)
  }

  function confirmarExclusao() {
    if (!excluindo) return
    const id = excluindo.id
    startTransition(async () => {
      const resultado = await deleteWebhookAction(id)
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
      setExcluindo(null)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2">
              <WebhookIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              Webhooks
            </CardTitle>
            <CardDescription>
              {`Receba os eventos do painel em outro sistema. Até ${WEBHOOK_LIMITE} webhooks — `}
              {limiteAtingido ? "limite atingido." : `${restantes} disponíveis.`}
            </CardDescription>
          </div>
          <Button onClick={abrirNovo} disabled={limiteAtingido} className="shrink-0">
            <Plus className="size-4" />
            Adicionar webhook
          </Button>
        </CardHeader>

        <CardContent>
          {webhooks.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <WebhookIcon className="size-5" aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>Nenhum webhook configurado</EmptyTitle>
                <EmptyDescription>
                  Cadastre um endpoint https e escolha quais eventos do app devem ser notificados.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={abrirNovo}>
                  <Plus className="size-4" />
                  Adicionar webhook
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {webhooks.map((webhook) => (
                <li key={webhook.id}>
                  <WebhookItem
                    webhook={webhook}
                    onEditar={() => abrirEdicao(webhook)}
                    onExcluir={() => setExcluindo(webhook)}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <WebhookFormDialog open={dialogAberto} onOpenChange={setDialogAberto} webhook={emEdicao} />

      <AlertDialog open={Boolean(excluindo)} onOpenChange={(aberto) => !aberto && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluindo
                ? `"${excluindo.nome}" deixará de receber eventos. Esta ação não pode ser desfeita.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmarExclusao} disabled={pending}>
              {pending ? <Spinner /> : null}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function WebhookItem({
  webhook,
  onEditar,
  onExcluir,
}: {
  webhook: Webhook
  onEditar: () => void
  onExcluir: () => void
}) {
  const [testando, startTeste] = useTransition()
  const [secretVisivel, setSecretVisivel] = useState(false)

  const todosEventos = webhook.eventos.length === WEBHOOK_EVENTS.length
  // Só as primeiras chaves ficam visíveis; o resto vira um contador.
  const visiveis = webhook.eventos.slice(0, 4)
  const ocultos = webhook.eventos.length - visiveis.length

  function testar() {
    startTeste(async () => {
      const resultado = await testWebhookAction(webhook.id)
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
    })
  }

  async function copiarSecret() {
    try {
      await navigator.clipboard.writeText(webhook.secret)
      toast.success("Secret copiado.")
    } catch {
      toast.error("Não foi possível copiar o secret.")
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{webhook.nome}</span>
            {webhook.ativo ? (
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                Ativo
              </Badge>
            ) : (
              <Badge variant="secondary">Pausado</Badge>
            )}
          </div>
          <span className="truncate font-mono text-xs text-muted-foreground">{webhook.url}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={testar} disabled={testando}>
            {testando ? <Spinner /> : <Send className="size-4" />}
            Testar
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onEditar} aria-label={`Editar ${webhook.nome}`}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onExcluir} aria-label={`Remover ${webhook.nome}`}>
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {todosEventos ? (
          <Badge variant="secondary">Todos os eventos ({webhook.eventos.length})</Badge>
        ) : (
          <>
            {visiveis.map((evento) => (
              <Badge key={evento} variant="secondary" className="font-normal">
                {WEBHOOK_EVENT_LABEL[evento] ?? evento}
              </Badge>
            ))}
            {ocultos > 0 ? <Badge variant="outline">+{ocultos}</Badge> : null}
          </>
        )}
      </div>

      <Separator />

      <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0">Secret:</span>
          <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono">
            {secretVisivel ? webhook.secret : "•".repeat(24)}
          </code>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSecretVisivel((v) => !v)}
            aria-label={secretVisivel ? "Ocultar secret" : "Mostrar secret"}
          >
            {secretVisivel ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={copiarSecret} aria-label="Copiar secret">
            <Copy className="size-3.5" />
          </Button>
        </div>
        <span>
          {webhook.ultimoEnvioEm
            ? `Último envio ${formatDateTime(webhook.ultimoEnvioEm)}${
                webhook.ultimoEnvioStatus ? ` · HTTP ${webhook.ultimoEnvioStatus}` : ""
              }`
            : "Nenhum envio ainda"}
        </span>
      </div>
    </div>
  )
}
