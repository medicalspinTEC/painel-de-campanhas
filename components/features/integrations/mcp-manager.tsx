"use client"

import { useEffect, useState, useTransition } from "react"
import { CheckCircle, CircleSlash, ClipboardCopy, RefreshCcw, Trash2, Waypoints } from "lucide-react"
import { toast } from "sonner"

import { definirMcpAtivoAction, gerarTokenMcpAction, revogarTokenMcpAction } from "@/app/actions/mcp"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Spinner } from "@/components/ui/spinner"
import { formatDateTime } from "@/lib/format"
import type { McpStatus } from "@/services/mcp-token"

type Confirmacao = "trocar" | "remover" | null

export function McpManager({ statusInicial }: { statusInicial: McpStatus | null }) {
  const [status, setStatus] = useState<McpStatus | null>(statusInicial)
  // O token em texto só existe aqui, logo após gerar: o servidor guarda apenas o hash.
  const [tokenNovo, setTokenNovo] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState<Confirmacao>(null)
  const [pending, startTransition] = useTransition()
  const [baseUrl, setBaseUrl] = useState("")

  useEffect(() => {
    setBaseUrl(window.location.origin)
  }, [])

  const endpoint = `${baseUrl}/api/mcp`

  function copiar(texto: string, rotulo: string) {
    navigator.clipboard.writeText(texto).then(() => toast.success(`${rotulo} copiado!`))
  }

  function gerar() {
    startTransition(async () => {
      const resultado = await gerarTokenMcpAction()
      if (resultado.ok && resultado.token) {
        setTokenNovo(resultado.token)
        setStatus({ ativo: true, prefixo: resultado.token.slice(0, 12), criadoEm: new Date().toISOString(), ultimoUsoEm: null })
        toast.success(resultado.message)
      } else {
        toast.error(resultado.message)
      }
      setConfirmar(null)
    })
  }

  function alternar() {
    if (!status) return
    const ativo = !status.ativo
    startTransition(async () => {
      const resultado = await definirMcpAtivoAction(ativo)
      if (resultado.ok) {
        setStatus((atual) => (atual ? { ...atual, ativo } : atual))
        toast.success(resultado.message)
      } else {
        toast.error(resultado.message)
      }
    })
  }

  function remover() {
    startTransition(async () => {
      const resultado = await revogarTokenMcpAction()
      if (resultado.ok) {
        setStatus(null)
        setTokenNovo(null)
        toast.success(resultado.message)
      } else {
        toast.error(resultado.message)
      }
      setConfirmar(null)
    })
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2">
              <Waypoints className="size-4 text-muted-foreground" aria-hidden="true" />
              MCP (Claude e outros assistentes)
              {status ? (
                status.ativo ? (
                  <Badge variant="outline" className="border-green-500/30 text-green-600 dark:text-green-400">
                    Ativo
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-destructive/30 text-destructive">
                    Desativado
                  </Badge>
                )
              ) : (
                <Badge variant="secondary">Desligado</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Conecta um assistente MCP aos dados desta instância (leads, campanhas, produtos, indicadores e eventos). Vem
              desligado: só funciona depois que você gera o token. Ele vale apenas para esta instância, nunca para as outras.
            </CardDescription>
          </div>

          <div className="flex shrink-0 gap-2">
            {status ? (
              <>
                <Button variant="outline" size="sm" onClick={alternar} disabled={pending}>
                  {status.ativo ? <CircleSlash className="size-4" /> : <CheckCircle className="size-4" />}
                  {status.ativo ? "Desativar" : "Ativar"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmar("remover")} disabled={pending}>
                  <Trash2 className="size-4" />
                  Remover
                </Button>
              </>
            ) : null}
            <Button size="sm" onClick={status ? () => setConfirmar("trocar") : gerar} disabled={pending}>
              {pending ? <Spinner className="size-4" /> : <RefreshCcw className="size-4" />}
              {status ? "Gerar novo token" : "Gerar token"}
            </Button>
          </div>
        </CardHeader>

        {status ? (
          <CardContent className="flex flex-col gap-4">
            {tokenNovo ? (
              <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                <span className="text-xs font-medium">Copie agora — este token não será mostrado de novo.</span>
                <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
                  <code className="flex-1 break-all font-mono text-xs">{tokenNovo}</code>
                  <Button variant="ghost" size="icon" className="shrink-0" onClick={() => copiar(tokenNovo, "Token")} aria-label="Copiar token">
                    <ClipboardCopy className="size-4" />
                  </Button>
                </div>
                <span className="text-xs font-medium">URL para conectores que só pedem o endereço (ex.: Claude.ai)</span>
                <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
                  <code className="flex-1 break-all font-mono text-xs">{`${endpoint}?token=${tokenNovo}`}</code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => copiar(`${endpoint}?token=${tokenNovo}`, "URL")}
                    aria-label="Copiar URL com token"
                  >
                    <ClipboardCopy className="size-4" />
                  </Button>
                </div>
                <span className="text-xs text-muted-foreground">
                  Quem tiver esta URL acessa os dados desta instância: trate-a como uma senha. Quando o cliente permitir, prefira enviar o token no header
                  Authorization.
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Token atual</span>
                <code className="rounded-md border bg-muted/50 px-3 py-2 font-mono text-xs">{status.prefixo}…</code>
                <span className="text-xs text-muted-foreground">
                  O token completo não é guardado. Se o perdeu, gere um novo (o atual deixa de funcionar).
                </span>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Endereço do MCP</span>
              <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
                <code className="flex-1 break-all font-mono text-xs">{endpoint}</code>
                <Button variant="ghost" size="icon" className="shrink-0" onClick={() => copiar(endpoint, "Endereço")} aria-label="Copiar endereço">
                  <ClipboardCopy className="size-4" />
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">{`Authorization: Bearer <token>\n# ou: x-mcp-token: <token>`}</pre>
            </div>

            <p className="text-xs text-muted-foreground">
              Criado em {formatDateTime(status.criadoEm)} ·{" "}
              {status.ultimoUsoEm ? `último uso em ${formatDateTime(status.ultimoUsoEm)}` : "ainda não foi usado"}
            </p>
          </CardContent>
        ) : null}
      </Card>

      <AlertDialog open={confirmar !== null} onOpenChange={(aberto) => !aberto && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmar === "remover" ? "Remover o token do MCP?" : "Gerar um novo token?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar === "remover"
                ? "O MCP desta instância volta a ficar desligado e os assistentes conectados param de funcionar."
                : "O token atual deixa de funcionar na hora. Atualize o conector de quem usa o MCP com o novo token."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmar === "remover" ? remover : gerar} disabled={pending}>
              {pending ? <Spinner /> : null}
              {confirmar === "remover" ? "Remover" : "Gerar novo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
