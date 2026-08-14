"use client"

import { useState } from "react"
import { AlertTriangle, Check, Copy, Eye, EyeOff, KeyRound } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

function CopyButton({ value, label = "Copiar" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-8 gap-1.5 px-2.5 text-xs"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? "Copiado" : label}
    </Button>
  )
}

export function TokenPanel({
  apiToken,
  baseUrl,
  className,
}: {
  apiToken: string
  baseUrl: string
  className?: string
}) {
  const [revelado, setRevelado] = useState(false)
  const configurado = apiToken.length > 0

  const mascarado = configurado ? `${apiToken.slice(0, 4)}${"•".repeat(Math.max(apiToken.length - 8, 4))}${apiToken.slice(-4)}` : ""

  const envSnippet = `API_TOKEN=${apiToken || "cole-seu-token-aqui"}`
  const headerSnippet = `Authorization: Bearer ${apiToken || "SEU_TOKEN"}`

  if (!configurado) {
    return (
      <Card className={cn("flex flex-col gap-3 border-chart-4/40 bg-chart-4/5 p-4", className)}>
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-chart-4" aria-hidden />
          <h2 className="text-sm font-semibold">Token de API não configurado</h2>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Defina a variável <code className="font-mono">API_TOKEN</code> no seu <code className="font-mono">.env</code> para
          liberar o acesso às rotas de <code className="font-mono">/api/*</code> por token e habilitar o painel de testes
          abaixo. Gere um valor forte e reinicie o servidor.
        </p>
        <div className="relative">
          <div className="absolute right-2 top-2 z-10">
            <CopyButton value={`API_TOKEN=${"$(openssl rand -hex 24)"}`} />
          </div>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 pr-16 font-mono text-xs leading-relaxed">
            <code>{`# .env.local\nAPI_TOKEN=$(openssl rand -hex 24)`}</code>
          </pre>
        </div>
      </Card>
    )
  }

  return (
    <Card className={cn("flex flex-col gap-4 p-4", className)}>
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold">Credenciais de acesso</h2>
        <Badge variant="outline" className="ml-auto gap-1.5 text-[10px]">
          <Check className="size-3 text-chart-2" aria-hidden />
          API_TOKEN ativo
        </Badge>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        As rotas de <code className="font-mono">/api/*</code> aceitam este token via header{" "}
        <code className="font-mono">Authorization: Bearer &lt;token&gt;</code> (ou{" "}
        <code className="font-mono">x-api-token</code>). Os exemplos de <code className="font-mono">curl</code> e o painel de
        testes abaixo já usam este valor.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">API_TOKEN</span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
              {revelado ? apiToken : mascarado}
            </code>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
              onClick={() => setRevelado((v) => !v)}
              aria-label={revelado ? "Ocultar token" : "Revelar token"}
            >
              {revelado ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
            </Button>
            <CopyButton value={apiToken} />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">URL base</span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
              {baseUrl || "—"}
            </code>
            {baseUrl ? <CopyButton value={baseUrl} /> : null}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="relative">
          <div className="absolute right-2 top-2 z-10">
            <CopyButton value={envSnippet} label=".env" />
          </div>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 pr-16 font-mono text-xs leading-relaxed">
            <code>{envSnippet}</code>
          </pre>
        </div>
        <div className="relative">
          <div className="absolute right-2 top-2 z-10">
            <CopyButton value={headerSnippet} label="header" />
          </div>
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 pr-16 font-mono text-xs leading-relaxed">
            <code>{headerSnippet}</code>
          </pre>
        </div>
      </div>
    </Card>
  )
}
