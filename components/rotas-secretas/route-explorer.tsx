"use client"

import { useMemo, useState } from "react"
import { Check, ChevronDown, Copy, Lock, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { EndpointDoc, FieldDoc, ResponseDoc } from "@/lib/api-docs"
import type { HttpMethod } from "@/lib/api-routes"

export type EndpointView = {
  method: HttpMethod
  urlPath: string
  filePath: string
  dinamica: boolean
  doc: EndpointDoc | null
}

const METHOD_STYLES: Record<HttpMethod, string> = {
  GET: "bg-primary/15 text-primary",
  POST: "bg-chart-2/15 text-chart-2",
  PUT: "bg-chart-4/20 text-chart-4",
  PATCH: "bg-chart-3/25 text-chart-3",
  DELETE: "bg-destructive/15 text-destructive",
  HEAD: "bg-muted text-muted-foreground",
  OPTIONS: "bg-muted text-muted-foreground",
}

function statusStyle(status: number): string {
  if (status < 300) return "bg-chart-2/15 text-chart-2"
  if (status < 400) return "bg-chart-4/20 text-chart-4"
  if (status < 500) return "bg-chart-3/25 text-chart-3"
  return "bg-destructive/15 text-destructive"
}

function CopyButton({ value, label = "Copiar" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
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

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <div className="absolute right-2 top-2 z-10">
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 pr-16 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

function FieldTable({ titulo, campos }: { titulo: string; campos: FieldDoc[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h4>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Campo</th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Descrição</th>
            </tr>
          </thead>
          <tbody>
            {campos.map((c) => (
              <tr key={c.nome} className="border-t border-border align-top">
                <td className="px-3 py-2 font-mono text-xs">
                  <span className="font-medium">{c.nome}</span>
                  {c.obrigatorio ? <span className="ml-1 text-destructive">*</span> : null}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{c.tipo}</td>
                <td className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">{c.descricao}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ResponseList({ respostas }: { respostas: ResponseDoc[] }) {
  return (
    <div className="flex flex-col gap-3">
      {respostas.map((r) => (
        <div key={r.status} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className={`inline-flex h-5 items-center rounded-md px-2 font-mono text-[11px] font-semibold ${statusStyle(r.status)}`}>
              {r.status}
            </span>
            <span className="text-xs text-muted-foreground">{r.descricao}</span>
          </div>
          {r.exemplo ? <CodeBlock code={r.exemplo} /> : null}
        </div>
      ))}
    </div>
  )
}

function EndpointCard({ endpoint }: { endpoint: EndpointView }) {
  const [aberto, setAberto] = useState(false)
  const { doc } = endpoint

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/40"
        aria-expanded={aberto}
      >
        <span className={`inline-flex h-6 shrink-0 items-center rounded-md px-2 font-mono text-[11px] font-semibold ${METHOD_STYLES[endpoint.method]}`}>
          {endpoint.method}
        </span>
        <code className="min-w-0 flex-1 truncate font-mono text-sm font-medium">{endpoint.urlPath}</code>
        {doc ? (
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{doc.resumo}</span>
        ) : (
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            sem doc
          </Badge>
        )}
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {aberto ? (
        <div className="flex flex-col gap-5 border-t border-border p-4">
          {doc ? (
            <>
              <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{doc.descricao}</p>

              <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3">
                <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">Autenticação: </span>
                  {doc.auth}
                </p>
              </div>

              {doc.pathParams?.length ? <FieldTable titulo="Parâmetros de caminho" campos={doc.pathParams} /> : null}
              {doc.queryParams?.length ? <FieldTable titulo="Query string" campos={doc.queryParams} /> : null}
              {doc.headers?.length ? <FieldTable titulo="Headers" campos={doc.headers} /> : null}
              {doc.bodyFields?.length ? <FieldTable titulo="Corpo (JSON)" campos={doc.bodyFields} /> : null}

              <Tabs defaultValue={doc.requestExample ? "requisicao" : "resposta"}>
                <TabsList>
                  {doc.requestExample ? <TabsTrigger value="requisicao">Requisição</TabsTrigger> : null}
                  <TabsTrigger value="resposta">Respostas</TabsTrigger>
                  <TabsTrigger value="curl">curl</TabsTrigger>
                </TabsList>
                {doc.requestExample ? (
                  <TabsContent value="requisicao" className="mt-3">
                    <CodeBlock code={doc.requestExample} />
                  </TabsContent>
                ) : null}
                <TabsContent value="resposta" className="mt-3">
                  <ResponseList respostas={doc.responses} />
                </TabsContent>
                <TabsContent value="curl" className="mt-3">
                  <CodeBlock code={doc.curl} />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Substitua <code className="font-mono">$BASE</code> pela URL do site e{" "}
                    <code className="font-mono">SEU_TOKEN</code> por um cookie de sessão válido.
                  </p>
                </TabsContent>
              </Tabs>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Rota descoberta automaticamente pela varredura de <code className="font-mono text-xs">app/</code>. Ainda não
              há documentação detalhada escrita para ela.
            </p>
          )}

          <Separator />
          <p className="font-mono text-xs text-muted-foreground/70 break-all">{endpoint.filePath}</p>
        </div>
      ) : null}
    </Card>
  )
}

export function RouteExplorer({ grupos }: { grupos: { titulo: string; endpoints: EndpointView[] }[] }) {
  const [busca, setBusca] = useState("")

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return grupos
    return grupos
      .map((g) => ({
        titulo: g.titulo,
        endpoints: g.endpoints.filter(
          (e) =>
            e.urlPath.toLowerCase().includes(q) ||
            e.method.toLowerCase().includes(q) ||
            (e.doc?.resumo.toLowerCase().includes(q) ?? false) ||
            (e.doc?.descricao.toLowerCase().includes(q) ?? false),
        ),
      }))
      .filter((g) => g.endpoints.length > 0)
  }, [busca, grupos])

  return (
    <div className="flex flex-col gap-6">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Filtrar por caminho, método ou descrição…"
          className="pl-9"
          aria-label="Filtrar endpoints"
        />
      </div>

      {filtrados.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Nenhum endpoint corresponde a &quot;{busca}&quot;.
        </Card>
      ) : (
        filtrados.map((grupo) => (
          <section key={grupo.titulo} className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{grupo.titulo}</h2>
            <div className="flex flex-col gap-2.5">
              {grupo.endpoints.map((e) => (
                <EndpointCard key={`${e.method} ${e.urlPath}`} endpoint={e} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
