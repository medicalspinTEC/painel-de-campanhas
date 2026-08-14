import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { Braces, Lock, Radio } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { RouteExplorer, type EndpointView } from "@/components/rotas-secretas/route-explorer"
import { getConfiguredApiToken } from "@/lib/api-auth"
import { getEndpointDoc } from "@/lib/api-docs"
import { listApiRoutes } from "@/lib/api-routes"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export const metadata = {
  title: "Rotas de API · Painel interno",
  robots: { index: false, follow: false },
}

/**
 * Deriva o nome do grupo (recurso) a partir do caminho da URL, ex.:
 * /api/leads/:id -> "Leads". Rotas fora de /api caem em "Outras".
 */
function grupoDe(urlPath: string): string {
  const seg = urlPath.replace(/^\/api\//, "").split("/")[0] ?? ""
  const LABELS: Record<string, string> = {
    leads: "Leads",
    campanhas: "Campanhas",
    mensagens: "Mensagens",
    eventos: "Eventos",
    cron: "Cron / Engine",
    webhook: "Webhooks",
  }
  return LABELS[seg] ?? (urlPath.startsWith("/api") ? "Outras rotas de API" : "Páginas")
}

const ORDEM_GRUPOS = ["Leads", "Campanhas", "Mensagens", "Eventos", "Cron / Engine", "Webhooks", "Outras rotas de API"]

export default async function RotasSecretasPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  // Gate opcional: se ROTAS_SECRET_TOKEN estiver definido, exige ?token= correto.
  // Sem o token correto a página responde 404 para não revelar sua existência.
  const esperado = process.env.ROTAS_SECRET_TOKEN
  if (esperado) {
    const { token } = await searchParams
    if (token !== esperado) notFound()
  }

  // Deriva a URL base a partir dos headers da requisição para montar os
  // exemplos de curl e o painel de testes já com o host correto.
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? ""
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  const baseUrl = host ? `${proto}://${host}` : ""
  const apiToken = getConfiguredApiToken()

  const rotas = await listApiRoutes()

  // Expande cada rota em um endpoint por método HTTP e anexa a documentação.
  const endpoints: EndpointView[] = rotas.flatMap((rota) =>
    rota.methods.map((method) => ({
      method,
      urlPath: rota.urlPath,
      filePath: rota.filePath,
      dinamica: rota.dinamica,
      doc: getEndpointDoc(method, rota.urlPath),
    })),
  )

  const totalRotas = rotas.length
  const totalEndpoints = endpoints.length
  const documentados = endpoints.filter((e) => e.doc).length

  // Agrupa por recurso e ordena.
  const mapa = new Map<string, EndpointView[]>()
  for (const e of endpoints) {
    const g = grupoDe(e.urlPath)
    if (!mapa.has(g)) mapa.set(g, [])
    mapa.get(g)!.push(e)
  }
  const grupos = Array.from(mapa.entries())
    .map(([titulo, eps]) => ({ titulo, endpoints: eps }))
    .sort((a, b) => {
      const ia = ORDEM_GRUPOS.indexOf(a.titulo)
      const ib = ORDEM_GRUPOS.indexOf(b.titulo)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-10 md:px-6 md:py-14">
      <header className="mb-8 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Lock className="size-3.5" aria-hidden />
          <span>Painel interno · não listado no menu</span>
        </div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-balance">
          <Radio className="size-6 text-primary" aria-hidden />
          Referência da API do sistema
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-pretty text-muted-foreground">
          Documentação viva de todos os endpoints. As rotas são descobertas varrendo o diretório{" "}
          <code className="font-mono text-xs">app/</code> em tempo de execução; cada método traz parâmetros, corpo,
          exemplos de resposta e um <code className="font-mono text-xs">curl</code> pronto para copiar. Clique em um
          endpoint para expandir os detalhes.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="outline" className="gap-1.5">
            <Braces className="size-3" aria-hidden />
            {totalRotas} rota{totalRotas === 1 ? "" : "s"}
          </Badge>
          <Badge variant="outline">{totalEndpoints} endpoints</Badge>
          <Badge variant="outline">
            {documentados}/{totalEndpoints} documentados
          </Badge>
        </div>
      </header>

      {endpoints.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma rota de API encontrada no diretório <code className="font-mono text-xs">app/</code>.
        </p>
      ) : (
        <RouteExplorer grupos={grupos} baseUrl={baseUrl} apiToken={apiToken} />
      )}
    </main>
  )
}
