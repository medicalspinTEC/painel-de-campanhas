"use client"

import { useState, useTransition } from "react"
import {
  ArrowDownToLine,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  ClipboardCopy,
  Eye,
  EyeOff,
  RefreshCcw,
  RotateCcw,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { gerarTokenAction, limparEventosAction, toggleTokenAction } from "@/app/actions/inbound-webhook"
import { formatDateTime } from "@/lib/format"
import type { InboundEvent, InboundToken } from "@/services/inbound-webhook"
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
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"

const EXEMPLO_CURL = (token: string, baseUrl: string) => `curl -X POST ${baseUrl}/api/webhook/entrada \\
  -H "Content-Type: application/json" \\
  -H "x-webhook-token: ${token}" \\
  -d '{"evento":"pedido.criado","dados":{"id":"123","total":99.90}}'`

function getBaseUrl() {
  if (typeof window === "undefined") return ""
  return window.location.origin
}

interface Props {
  tokenInicial: InboundToken | null
  eventosIniciais: InboundEvent[]
}

export function InboundWebhookManager({ tokenInicial, eventosIniciais }: Props) {
  const [tokenInfo, setTokenInfo] = useState<InboundToken | null>(tokenInicial)
  const [eventos, setEventos] = useState<InboundEvent[]>(eventosIniciais)
  const [tokenVisivel, setTokenVisivel] = useState(false)
  const [confirmarLimpar, setConfirmarLimpar] = useState(false)
  const [confirmarGerar, setConfirmarGerar] = useState(false)
  const [expandidoId, setExpandidoId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const baseUrl = getBaseUrl()

  function copiar(texto: string, label: string) {
    navigator.clipboard.writeText(texto).then(() => toast.success(`${label} copiado!`))
  }

  function handleGerar() {
    if (tokenInfo) {
      setConfirmarGerar(true)
    } else {
      executarGerar()
    }
  }

  function executarGerar() {
    startTransition(async () => {
      const resultado = await gerarTokenAction()
      if (resultado.ok && resultado.token) {
        setTokenInfo((prev) =>
          prev
            ? { ...prev, token: resultado.token!, ativo: true }
            : {
                token: resultado.token!,
                ativo: true,
                criadoEm: new Date().toISOString(),
                ultimoUsoEm: null,
                totalEventos: 0,
              },
        )
        setTokenVisivel(true)
        toast.success(resultado.message)
      } else {
        toast.error(resultado.message)
      }
      setConfirmarGerar(false)
    })
  }

  function handleToggle() {
    if (!tokenInfo) return
    const novoAtivo = !tokenInfo.ativo
    startTransition(async () => {
      const resultado = await toggleTokenAction(novoAtivo)
      if (resultado.ok) {
        setTokenInfo((prev) => (prev ? { ...prev, ativo: novoAtivo } : prev))
        toast.success(resultado.message)
      } else {
        toast.error(resultado.message)
      }
    })
  }

  function executarLimpar() {
    startTransition(async () => {
      const resultado = await limparEventosAction()
      if (resultado.ok) {
        setEventos([])
        setTokenInfo((prev) => (prev ? { ...prev, totalEventos: 0 } : prev))
        toast.success(resultado.message)
      } else {
        toast.error(resultado.message)
      }
      setConfirmarLimpar(false)
    })
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2">
              <ArrowDownToLine className="size-4 text-muted-foreground" aria-hidden="true" />
              Webhook de Entrada
            </CardTitle>
            <CardDescription>
              Receba eventos de outras aplicações neste painel. Envie um POST para o endpoint abaixo com o
              token gerado.
            </CardDescription>
          </div>

          <div className="flex shrink-0 gap-2">
            {tokenInfo && (
              <Button variant="outline" size="sm" onClick={handleToggle} disabled={pending}>
                {pending ? (
                  <Spinner className="size-4" />
                ) : tokenInfo.ativo ? (
                  <CircleSlash className="size-4" />
                ) : (
                  <CheckCircle className="size-4" />
                )}
                {tokenInfo.ativo ? "Desativar" : "Ativar"}
              </Button>
            )}
            <Button size="sm" onClick={handleGerar} disabled={pending}>
              {pending ? <Spinner className="size-4" /> : <RefreshCcw className="size-4" />}
              {tokenInfo ? "Gerar novo token" : "Gerar token"}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {/* Endpoint */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Endpoint</span>
            <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
              <code className="flex-1 break-all font-mono text-xs">
                POST {baseUrl}/api/webhook/entrada
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => copiar(`${baseUrl}/api/webhook/entrada`, "Endpoint")}
                aria-label="Copiar endpoint"
              >
                <ClipboardCopy className="size-4" />
              </Button>
            </div>
          </div>

          {/* Token */}
          {tokenInfo ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Token de autenticação</span>
                <div className="flex items-center gap-1.5">
                  {tokenInfo.ativo ? (
                    <Badge variant="outline" className="border-green-500/30 text-green-600 dark:text-green-400">
                      Ativo
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-destructive/30 text-destructive">
                      Inativo
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
                <code className="flex-1 break-all font-mono text-xs">
                  {tokenVisivel ? tokenInfo.token : "whin_" + "•".repeat(48)}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => setTokenVisivel((v) => !v)}
                  aria-label={tokenVisivel ? "Ocultar token" : "Exibir token"}
                >
                  {tokenVisivel ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => copiar(tokenInfo.token, "Token")}
                  aria-label="Copiar token"
                >
                  <ClipboardCopy className="size-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Criado em {formatDateTime(tokenInfo.criadoEm)}</span>
                {tokenInfo.ultimoUsoEm && <span>Último uso em {formatDateTime(tokenInfo.ultimoUsoEm)}</span>}
                <span>{tokenInfo.totalEventos} evento{tokenInfo.totalEventos !== 1 ? "s" : ""} recebido{tokenInfo.totalEventos !== 1 ? "s" : ""}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum token configurado. Clique em <strong>Gerar token</strong> para ativar o endpoint.
            </p>
          )}

          {/* Exemplo cURL */}
          {tokenInfo && (
            <>
              <Separator />
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Exemplo de chamada</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() =>
                      copiar(
                        EXEMPLO_CURL(tokenInfo.token, baseUrl),
                        "Exemplo cURL",
                      )
                    }
                  >
                    <ClipboardCopy className="size-3" />
                    Copiar
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
                  {EXEMPLO_CURL(tokenVisivel ? tokenInfo.token : "<seu-token>", baseUrl)}
                </pre>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Log de eventos recebidos */}
      {tokenInfo && (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <CardTitle className="flex items-center gap-2 text-base">
                Eventos recebidos
                {eventos.length > 0 && (
                  <Badge variant="secondary">{eventos.length}</Badge>
                )}
              </CardTitle>
              <CardDescription>Últimos 50 eventos registrados pelo webhook de entrada.</CardDescription>
            </div>
            {eventos.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 text-destructive hover:text-destructive"
                onClick={() => setConfirmarLimpar(true)}
                disabled={pending}
              >
                <Trash2 className="size-4" />
                Limpar histórico
              </Button>
            )}
          </CardHeader>

          <CardContent>
            {eventos.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhum evento recebido ainda. Envie um POST para o endpoint acima para começar.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {eventos.map((evento) => {
                  const aberto = expandidoId === evento.id
                  return (
                    <li key={evento.id} className="rounded-lg border">
                      <button
                        type="button"
                        onClick={() => setExpandidoId(aberto ? null : evento.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
                        aria-expanded={aberto}
                      >
                        {aberto ? (
                          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <code className="flex-1 truncate font-mono text-xs font-medium">{evento.evento}</code>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDateTime(evento.recebidoEm)}
                        </span>
                        {evento.origem && (
                          <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                            {evento.origem}
                          </span>
                        )}
                      </button>
                      {aberto && (
                        <div className="border-t px-4 py-3">
                          <div className="flex items-center justify-between pb-1.5">
                            <span className="text-xs font-medium text-muted-foreground">Payload</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs"
                              onClick={() =>
                                copiar(JSON.stringify(evento.payload, null, 2), "Payload")
                              }
                            >
                              <ClipboardCopy className="size-3" />
                              Copiar
                            </Button>
                          </div>
                          <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
                            {JSON.stringify(evento.payload, null, 2)}
                          </pre>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* Confirmar geração de novo token */}
      <AlertDialog open={confirmarGerar} onOpenChange={setConfirmarGerar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gerar novo token?</AlertDialogTitle>
            <AlertDialogDescription>
              O token atual será invalidado imediatamente. Qualquer sistema que use o token antigo precisará ser
              atualizado com o novo valor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={executarGerar} disabled={pending}>
              {pending ? <Spinner className="size-4" /> : <RotateCcw className="size-4" />}
              Gerar novo token
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmar limpeza de eventos */}
      <AlertDialog open={confirmarLimpar} onOpenChange={setConfirmarLimpar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpar histórico?</AlertDialogTitle>
            <AlertDialogDescription>
              Todos os {eventos.length} evento{eventos.length !== 1 ? "s" : ""} recebido{eventos.length !== 1 ? "s" : ""} serão removidos permanentemente. O token não será
              afetado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={executarLimpar}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? <Spinner className="size-4" /> : <Trash2 className="size-4" />}
              Limpar tudo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
