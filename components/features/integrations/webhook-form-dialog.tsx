"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { createWebhookAction, updateWebhookAction } from "@/app/actions/webhooks"
import { EventSelector } from "@/components/features/integrations/event-selector"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import type { Webhook } from "@/services/webhooks"

export function WebhookFormDialog({
  open,
  onOpenChange,
  webhook,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  webhook?: Webhook | null
}) {
  const editando = Boolean(webhook)
  const [pending, startTransition] = useTransition()

  const [nome, setNome] = useState("")
  const [url, setUrl] = useState("")
  const [eventos, setEventos] = useState<string[]>([])
  const [ativo, setAtivo] = useState(true)

  /*
   * O diálogo é montado uma única vez e reaproveitado para criar e editar, então
   * os campos são recarregados sempre que ele abre com outro webhook.
   */
  useEffect(() => {
    if (!open) return
    setNome(webhook?.nome ?? "")
    setUrl(webhook?.url ?? "")
    setEventos(webhook?.eventos ?? [])
    setAtivo(webhook?.ativo ?? true)
  }, [open, webhook])

  function salvar() {
    startTransition(async () => {
      const payload = { nome, url, eventos, ativo }
      const resultado = webhook
        ? await updateWebhookAction(webhook.id, payload)
        : await createWebhookAction(payload)

      if (resultado.ok) {
        toast.success(resultado.message)
        onOpenChange(false)
      } else {
        toast.error(resultado.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>{editando ? "Editar webhook" : "Novo webhook"}</DialogTitle>
          <DialogDescription>
            O painel envia um POST em JSON para a URL informada a cada evento assinado.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
          <Field>
            <FieldLabel htmlFor="webhook-nome">Nome</FieldLabel>
            <Input
              id="webhook-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="CRM interno"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="webhook-url">URL de destino</FieldLabel>
            <Input
              id="webhook-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.suaempresa.com/hooks/engine"
            />
            <FieldDescription>Somente endereços https são aceitos.</FieldDescription>
          </Field>

          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <label htmlFor="webhook-ativo" className="text-sm font-medium">
                Webhook ativo
              </label>
              <span className="text-sm text-muted-foreground">Desative para pausar os envios sem apagar a config.</span>
            </div>
            <Switch id="webhook-ativo" checked={ativo} onCheckedChange={setAtivo} />
          </div>

          <Field>
            <FieldLabel>Eventos assinados</FieldLabel>
            <EventSelector selecionados={eventos} onChange={setEventos} />
          </Field>
        </div>

        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={salvar} disabled={pending}>
            {pending ? <Spinner /> : null}
            {editando ? "Salvar alterações" : "Criar webhook"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
