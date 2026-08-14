"use client"

import { useMemo, useState } from "react"
import { Check, ChevronDown, Copy, Lock, Play, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
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
  if (status === 0) return "bg-destructive/15 text-destructive"
  if (status < 300) return "bg-chart-2/15 text-chart-2"
  if (status < 400) return "bg-chart-4/20 text-chart-4"
  if (status < 500) return "bg-chart-3/25 text-chart-3"
  return "bg-destructive/15 text-destructive"
}

const METODOS_COM_CORPO: HttpMethod[] = ["POST", "PUT", "PATCH"]

/** Extrai os nomes dos parâmetros de caminho (ex.: ":id" -> "id"). */
function extrairPathParams(urlPath: string): string[] {
  return urlPath
    .split("/")
    .filter((seg) => seg.startsWith(":"))
    .map((seg) => seg.slice(1))
}

/**
 * Prepara o comando curl para cópia imediata: troca `$BASE` pela URL real e o
 * cabeçalho de cookie de sessão pelo header `Authorization: Bearer <token>`.
 */
function prepararCurl(curl: string, baseUrl: string, apiToken: string): string {
  let saida = curl
  if (baseUrl) saida = saida.replaceAll("$BASE", baseUrl)
  if (apiToken) {
    saida = saida.replaceAll("Cookie: campanhas_session=SEU_TOKEN", `Authorization: Bearer ${apiToken}`)
  }
  return saida
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

type ResultadoTeste = {
  status: number
  statusText: string
  corpo: string
  duracaoMs: number
  erro?: string
}

/** Painel interativo para disparar a requisição contra a API real. */
function TestPanel({ endpoint, baseUrl, apiToken }: { endpoint: EndpointView; baseUrl: string; apiToken: string }) {
  const pathParams = useMemo(() => extrairPathParams(endpoint.urlPath), [endpoint.urlPath])
  const metodoComCorpo = METODOS_COM_CORPO.includes(endpoint.method)

  const [valores, setValores] = useState<Record<string, string>>({})
  const [query, setQuery] = useState("")
  const [corpo, setCorpo] = useState(endpoint.doc?.requestExample ?? "")
  const [headersExtra, setHeadersExtra] = useState("")
  const [mostrarHeaders, setMostrarHeaders] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoTeste | null>(null)

  const podeEnviar = Boolean(baseUrl) && !carregando

  async function enviar() {
    setCarregando(true)
    setResultado(null)
    const inicio = performance.now()
    try {
      const caminho = endpoint.urlPath.replace(/:([A-Za-z0-9_]+)/g, (_, chave: string) =>
        encodeURIComponent(valores[chave] ?? ""),
      )
      const q = query.trim() ? (query.trim().startsWith("?") ? query.trim() : `?${query.trim()}`) : ""
      const url = `${baseUrl}${caminho}${q}`

      const headers: Record<string, string> = {}
      if (apiToken) headers["Authorization"] = `Bearer ${apiToken}`

      const temCorpo = metodoComCorpo && corpo.trim().length > 0
      if (temCorpo) headers["Content-Type"] = "application/json"

      if (headersExtra.trim()) {
        try {
          Object.assign(headers, JSON.parse(headersExtra))
        } catch {
          throw new Error("Headers adicionais precisam ser um JSON válido.")
        }
      }

      const res = await fetch(url, {
        method: endpoint.method,
        headers,
        body: temCorpo ? corpo : undefined,
      })
      const texto = await res.text()
      let formatado = texto
      try {
        formatado = JSON.stringify(JSON.parse(texto), null, 2)
      } catch {
        /* mantém o texto cru quando não for JSON */
      }
      setResultado({
        status: res.status,
        statusText: res.statusText,
        corpo: formatado,
        duracaoMs: Math.round(performance.now() - inicio),
      })
    } catch (e) {
      setResultado({
        status: 0,
        statusText: "Erro",
        corpo: "",
        duracaoMs: Math.round(performance.now() - inicio),
        erro: e instanceof Error ? e.message : "Falha ao enviar a requisição.",
      })
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {pathParams.length > 0 ? (
        <div className="flex flex-col gap-3">
          {pathParams.map((param) => (
            <div key={param} className="flex flex-col gap-1.5">
              <Label htmlFor={`${endpoint.method}-${param}`} className="text-xs">
                Parâmetro <code className="font-mono">:{param}</code>
              </Label>
              <Input
                id={`${endpoint.method}-${param}`}
                value={valores[param] ?? ""}
                onChange={(e) => setValores((v) => ({ ...v, [param]: e.target.value }))}
                placeholder={`Valor de ${param}`}
                className="font-mono text-xs"
              />
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${endpoint.method}-query`} className="text-xs">
          Query string <span className="text-muted-foreground">(opcional)</span>
        </Label>
        <Input
          id={`${endpoint.method}-query`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="?token=...&limite=10"
          className="font-mono text-xs"
        />
      </div>

      {metodoComCorpo ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${endpoint.method}-body`} className="text-xs">
            Corpo (JSON)
          </Label>
          <Textarea
            id={`${endpoint.method}-body`}
            value={corpo}
            onChange={(e) => setCorpo(e.target.value)}
            rows={8}
            spellCheck={false}
            className="font-mono text-xs"
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setMostrarHeaders((v) => !v)}
          className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={`size-3.5 transition-transform ${mostrarHeaders ? "rotate-180" : ""}`} aria-hidden />
          Headers adicionais (JSON)
        </button>
        {mostrarHeaders ? (
          <Textarea
            value={headersExtra}
            onChange={(e) => setHeadersExtra(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder={`{ "x-webhook-token": "..." }`}
            className="font-mono text-xs"
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={enviar} disabled={!podeEnviar} className="gap-2">
          {carregando ? <Spinner className="size-4" /> : <Play className="size-4" aria-hidden />}
          Enviar requisição
        </Button>
        <span className="text-xs text-muted-foreground">
          {apiToken ? "Autenticado com o API_TOKEN." : "Sem API_TOKEN — usando a sessão atual do navegador."}
        </span>
      </div>

      {!baseUrl ? (
        <p className="text-xs text-chart-4">Não foi possível detectar a URL base para executar o teste.</p>
      ) : null}

      {resultado ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className={`inline-flex h-5 items-center rounded-md px-2 font-mono text-[11px] font-semibold ${statusStyle(resultado.status)}`}>
              {resultado.status || "ERRO"}
            </span>
            <span className="text-xs text-muted-foreground">{resultado.statusText}</span>
            <span className="ml-auto text-xs text-muted-foreground">{resultado.duracaoMs} ms</span>
          </div>
          {resultado.erro ? (
            <p className="text-xs text-destructive">{resultado.erro}</p>
          ) : (
            <CodeBlock code={resultado.corpo || "(resposta vazia)"} />
          )}
        </div>
      ) : null}
    </div>
  )
}

function EndpointCard({ endpoint, baseUrl, apiToken }: { endpoint: EndpointView; baseUrl: string; apiToken: string }) {
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

              <Tabs defaultValue="testar">
                <TabsList>
                  <TabsTrigger value="testar">Testar</TabsTrigger>
                  {doc.requestExample ? <TabsTrigger value="requisicao">Requisição</TabsTrigger> : null}
                  <TabsTrigger value="resposta">Respostas</TabsTrigger>
                  <TabsTrigger value="curl">curl</TabsTrigger>
                </TabsList>
                <TabsContent value="testar" className="mt-3">
                  <TestPanel endpoint={endpoint} baseUrl={baseUrl} apiToken={apiToken} />
                </TabsContent>
                {doc.requestExample ? (
                  <TabsContent value="requisicao" className="mt-3">
                    <CodeBlock code={doc.requestExample} />
                  </TabsContent>
                ) : null}
                <TabsContent value="resposta" className="mt-3">
                  <ResponseList respostas={doc.responses} />
                </TabsContent>
                <TabsContent value="curl" className="mt-3">
                  <CodeBlock code={prepararCurl(doc.curl, baseUrl, apiToken)} />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {apiToken
                      ? "O comando já vem com a URL base e o API_TOKEN preenchidos — é só copiar e colar."
                      : "Defina o API_TOKEN no .env para que o comando seja gerado já autenticado."}
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

export function RouteExplorer({
  grupos,
  baseUrl,
  apiToken,
}: {
  grupos: { titulo: string; endpoints: EndpointView[] }[]
  baseUrl: string
  apiToken: string
}) {
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
                <EndpointCard key={`${e.method} ${e.urlPath}`} endpoint={e} baseUrl={baseUrl} apiToken={apiToken} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
