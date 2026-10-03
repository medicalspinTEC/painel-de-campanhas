"use client"

import { CheckCircle2, CircleSlash, FlaskConical, Webhook, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ExecutionRow, PassoExecucao } from "@/services/nocode"

const STATUS_EXECUCAO = {
  sucesso: { label: "Sucesso", icone: CheckCircle2, classe: "text-emerald-600 dark:text-emerald-400" },
  erro: { label: "Erro", icone: XCircle, classe: "text-destructive" },
  ignorado: { label: "Ignorado", icone: CircleSlash, classe: "text-muted-foreground" },
} as const

const STATUS_PASSO: Record<PassoExecucao["status"], string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  erro: "text-destructive",
  simulado: "text-amber-600 dark:text-amber-400",
  ignorado: "text-muted-foreground",
}

function json(valor: unknown, limite = 4000): string {
  try {
    const texto = JSON.stringify(valor, null, 2) ?? ""
    return texto.length > limite ? `${texto.slice(0, limite)}\n… (cortado)` : texto
  } catch {
    return String(valor)
  }
}

export function ExecutionItem({ execucao, aberto = false }: { execucao: ExecutionRow; aberto?: boolean }) {
  const status = STATUS_EXECUCAO[execucao.status] ?? STATUS_EXECUCAO.ignorado
  const Icone = status.icone
  const OrigemIcone = execucao.origem === "teste" ? FlaskConical : Webhook

  return (
    <details open={aberto} className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5">
        <Icone className={cn("size-4 shrink-0", status.classe)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium leading-tight">{status.label}</span>
          <span className="truncate text-xs text-muted-foreground" suppressHydrationWarning>
            {formatDateTime(execucao.iniciadoEm)} · {execucao.duracaoMs} ms · {execucao.passos.length} passo
            {execucao.passos.length === 1 ? "" : "s"}
          </span>
        </div>
        <Badge variant="secondary" className="gap-1">
          <OrigemIcone className="size-3" />
          {execucao.origem === "teste" ? "Teste" : "Webhook"}
        </Badge>
      </summary>

      <div className="flex flex-col gap-3 border-t px-3 py-3">
        {execucao.erro ? (
          <p className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">{execucao.erro}</p>
        ) : null}

        <ol className="flex flex-col gap-1.5">
          {execucao.passos.map((passo, indice) => (
            <li key={`${passo.nodeId}-${indice}`} className="rounded-md bg-muted/40 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium">
                  {indice + 1}. {passo.nome}
                </span>
                <span className={cn("shrink-0 font-medium", STATUS_PASSO[passo.status])}>
                  {passo.status}
                  {passo.saida && passo.saida !== "main" ? ` → ${passo.saida === "true" ? "verdadeiro" : "falso"}` : ""}
                  <span className="ml-1 font-normal text-muted-foreground">{passo.ms} ms</span>
                </span>
              </div>
              {passo.erro ? <p className="mt-1 text-xs text-destructive">{passo.erro}</p> : null}
              {passo.resumo !== undefined && passo.resumo !== null ? (
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-muted-foreground">
                  {typeof passo.resumo === "string" ? passo.resumo : json(passo.resumo, 1200)}
                </pre>
              ) : null}
            </li>
          ))}
        </ol>

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Evento recebido</summary>
          <pre className="mt-1.5 max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-snug">
            {json(execucao.entrada)}
          </pre>
        </details>
      </div>
    </details>
  )
}

export function ExecutionsPanel({ execucoes }: { execucoes: ExecutionRow[] }) {
  if (execucoes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Nenhuma execução ainda. Use “Testar” ou ative o fluxo e aponte o webhook da Evolution para ele.
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {execucoes.map((execucao) => (
        <ExecutionItem key={execucao.id} execucao={execucao} />
      ))}
    </div>
  )
}
