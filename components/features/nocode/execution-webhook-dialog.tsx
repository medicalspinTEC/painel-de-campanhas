"use client"

import { useState, useTransition } from "react"
import { Loader2, Send } from "lucide-react"
import { toast } from "sonner"

import { salvarWebhookExecucoesAction, testarWebhookExecucoesAction } from "@/app/actions/nocode"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { ConfigWebhookExecucoes } from "@/services/nocode-webhook-execucoes"

export function ExecutionWebhookDialog({
  open,
  onOpenChange,
  fluxoId,
  config,
  onSalvo,
}: {
  open: boolean
  onOpenChange: (aberto: boolean) => void
  fluxoId: string
  config: ConfigWebhookExecucoes
  onSalvo: (config: ConfigWebhookExecucoes) => void
}) {
  const [ativo, setAtivo] = useState(config.ativo)
  const [url, setUrl] = useState(config.url)
  const [segredo, setSegredo] = useState("")
  const [removerSegredo, setRemoverSegredo] = useState(false)
  const [pending, startTransition] = useTransition()
  const [testando, setTestando] = useState(false)

  /** `undefined` = manter o segredo salvo; `null` = remover; texto = definir. */
  function valorSegredo(): string | null | undefined {
    if (removerSegredo) return null
    return segredo.trim() ? segredo : undefined
  }

  function salvar() {
    startTransition(async () => {
      const resultado = await salvarWebhookExecucoesAction(fluxoId, { ativo, url, segredo: valorSegredo() })
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }
      onSalvo(resultado.config)
      toast.success(resultado.message)
      onOpenChange(false)
    })
  }

  async function testar() {
    setTestando(true)
    try {
      const resultado = await testarWebhookExecucoesAction(fluxoId, { url, segredo: valorSegredo() })
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
    } finally {
      setTestando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Webhook de execuções</DialogTitle>
          <DialogDescription>
            Cada execução do fluxo é enviada, completa, para a URL abaixo, para você guardá-la fora do app. Testes feitos
            aqui no editor não são enviados.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium">
            Enviar cada execução ao webhook
            <Switch checked={ativo} onCheckedChange={setAtivo} disabled={pending} aria-label="Ativar webhook de execuções" />
          </label>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exec-webhook-url">URL (recebe um POST em JSON)</Label>
            <Input
              id="exec-webhook-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://meu-servidor.com/execucoes"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exec-webhook-segredo">Segredo para assinar o envio (opcional)</Label>
            <Input
              id="exec-webhook-segredo"
              type="password"
              value={segredo}
              onChange={(event) => {
                setSegredo(event.target.value)
                setRemoverSegredo(false)
              }}
              placeholder={config.temSegredo && !removerSegredo ? "Segredo definido — deixe em branco para manter" : "Sem segredo"}
              autoComplete="new-password"
              maxLength={200}
            />
            {config.temSegredo ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={removerSegredo}
                  onChange={(event) => {
                    setRemoverSegredo(event.target.checked)
                    if (event.target.checked) setSegredo("")
                  }}
                />
                Remover o segredo salvo
              </label>
            ) : null}
          </div>

          <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">O que chega no seu servidor</p>
            <p>
              Corpo JSON com <code>evento</code>, <code>fluxo</code> e <code>execucao</code> (id, status, origem, data,
              duração, erro, <code>entrada</code> com o evento recebido e todos os <code>passos</code> com saídas e
              tempos). Headers: <code>X-Execution-Id</code> (use para não gravar duas vezes),{" "}
              <code>X-Execution-Event</code>, <code>X-Execution-Attempt</code> e, com segredo,{" "}
              <code>X-Execution-Signature: sha256=…</code> (HMAC-SHA256 do corpo).
            </p>
            <p className="mt-1.5">
              Responda com HTTP 2xx para confirmar. Se falhar, o app tenta de novo (1, 2, 4… até 30 min) enquanto a
              execução ainda estiver guardada.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => void testar()} disabled={testando || pending || !url.trim()}>
            {testando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Enviar teste
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={pending || (ativo && !url.trim())}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
