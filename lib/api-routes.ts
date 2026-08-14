import "server-only"

import { promises as fs } from "node:fs"
import path from "node:path"

/** Métodos HTTP que o Next.js reconhece como handlers em um route.ts. */
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const

export type HttpMethod = (typeof HTTP_METHODS)[number]

export type ApiRoute = {
  /** Caminho de URL público, ex: /api/webhook/entrada */
  urlPath: string
  /** Caminho do arquivo relativo à raiz do projeto. */
  filePath: string
  /** Métodos HTTP exportados pelo handler. */
  methods: HttpMethod[]
  /** Primeira linha do bloco de comentário no topo do arquivo, se houver. */
  descricao: string | null
  /** Indica se a rota é dinâmica (contém segmentos [param]). */
  dinamica: boolean
}

const ROUTE_FILE_REGEX = /^route\.(ts|tsx|js|jsx|mjs)$/

/**
 * Converte o caminho de um arquivo route.ts (relativo ao diretório `app`)
 * em um caminho de URL público, removendo grupos de rota `(grupo)` e
 * normalizando segmentos dinâmicos `[param]` e `[...param]`.
 */
function fileDirToUrl(relativeDir: string): string {
  const segments = relativeDir
    .split(path.sep)
    .filter(Boolean)
    // Remove grupos de rota: (app), (marketing), etc.
    .filter((seg) => !(seg.startsWith("(") && seg.endsWith(")")))
    // Remove segmentos privados/paralelos que não afetam a URL final de forma simples.
    .filter((seg) => !seg.startsWith("@"))
    .map((seg) => {
      if (seg.startsWith("[...") && seg.endsWith("]")) return `*${seg.slice(4, -1)}`
      if (seg.startsWith("[[...") && seg.endsWith("]]")) return `*${seg.slice(5, -2)}?`
      if (seg.startsWith("[") && seg.endsWith("]")) return `:${seg.slice(1, -1)}`
      return seg
    })

  return "/" + segments.join("/")
}

/** Extrai os métodos HTTP exportados a partir do conteúdo do arquivo. */
function extractMethods(content: string): HttpMethod[] {
  const found = new Set<HttpMethod>()
  for (const method of HTTP_METHODS) {
    const patterns = [
      new RegExp(`export\\s+async\\s+function\\s+${method}\\b`),
      new RegExp(`export\\s+function\\s+${method}\\b`),
      new RegExp(`export\\s+const\\s+${method}\\b`),
      new RegExp(`export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`),
    ]
    if (patterns.some((re) => re.test(content))) found.add(method)
  }
  return HTTP_METHODS.filter((m) => found.has(m))
}

/** Extrai a primeira frase de um bloco de comentário JSDoc no topo do arquivo. */
function extractDescription(content: string): string | null {
  const block = content.match(/\/\*\*?([\s\S]*?)\*\//)
  if (!block) return null
  const lines = block[1]
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .filter(Boolean)
  const first = lines.find((l) => l.length > 0 && !l.startsWith("@"))
  return first ?? null
}

async function walk(dir: string, results: string[]): Promise<void> {
  let entries: import("node:fs").Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue
      await walk(full, results)
    } else if (ROUTE_FILE_REGEX.test(entry.name)) {
      results.push(full)
    }
  }
}

/**
 * Varre o diretório `app` do projeto em tempo de execução e retorna todas as
 * rotas de API (route handlers) encontradas, com seus métodos e descrições.
 */
export async function listApiRoutes(): Promise<ApiRoute[]> {
  const appDir = path.join(process.cwd(), "app")
  const files: string[] = []
  await walk(appDir, files)

  const routes = await Promise.all(
    files.map(async (file) => {
      const content = await fs.readFile(file, "utf8").catch(() => "")
      const relativeDir = path.relative(appDir, path.dirname(file))
      const urlPath = fileDirToUrl(relativeDir) || "/"
      const route: ApiRoute = {
        urlPath,
        filePath: path.relative(process.cwd(), file),
        methods: extractMethods(content),
        descricao: extractDescription(content),
        dinamica: /\[.+\]/.test(relativeDir),
      }
      return route
    }),
  )

  return routes.sort((a, b) => a.urlPath.localeCompare(b.urlPath))
}
