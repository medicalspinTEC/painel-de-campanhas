import { NextResponse, type NextRequest } from "next/server"

import { extractApiToken } from "@/lib/api-auth"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth"

/**
 * Referência DIRETA à env aqui: o Turbopack só faz o inline de
 * `process.env.API_TOKEN` no bundle do proxy (Edge) quando ela aparece
 * literalmente neste módulo — dentro de libs importadas o inline não acontece.
 */
const API_TOKEN = process.env.API_TOKEN ?? ""

/**
 * `/api/mcp` não usa sessão nem `API_TOKEN`: cada instância tem o próprio token do MCP
 * (gerado em Integrações) e a própria rota o confere (`app/api/mcp/route.ts`). Por isso ela
 * passa por aqui sem sessão, mas sem token válido responde 401.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Proteção de rotas (equivalente ao antigo middleware no Next 16).
 *
 * Aqui só se verifica a ASSINATURA do cookie (o Edge não acessa o banco). Papel,
 * seções liberadas e status ativo são checados no servidor, por página, action e
 * rota de API (`lib/session.ts`).
 *
 * Tudo exige sessão, exceto a própria tela de login e os endpoints públicos de
 * automação (`/api/webhook/entrada` e `/api/cron`), que são chamados por
 * serviços externos e se autenticam por conta própria.
 *
 * As rotas de `/api/*` também aceitam o token estático `API_TOKEN` (via header
 * `Authorization: Bearer <token>` ou `x-api-token`) como alternativa ao cookie
 * de sessão — útil para integrações externas, `curl` e o painel de testes.
 */

// Rotas acessíveis sem sessão.
const ROTAS_PUBLICAS = ["/login", "/api/webhook/entrada", "/api/cron", "/api/nocode/webhook", "/api/mcp"]

function isPublica(pathname: string): boolean {
  return ROTAS_PUBLICAS.some((rota) => pathname === rota || pathname.startsWith(`${rota}/`))
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  const token = request.cookies.get(SESSION_COOKIE)?.value
  const sessaoValida = Boolean(await verifySessionToken(token))

  // Rotas de /api/* podem se autenticar pelo token estático de API.
  const tokenRecebido = extractApiToken(request.headers)
  const apiTokenValido =
    pathname.startsWith("/api/") && API_TOKEN.length > 0 && tokenRecebido !== null && timingSafeEqual(tokenRecebido, API_TOKEN)

  const autenticado = sessaoValida || apiTokenValido

  // /login: quem decide se já há sessão é a própria página (ela consulta o banco —
  // o cookie pode apontar para um usuário desativado ou excluído, e redirecionar
  // aqui só pela assinatura causaria um loop com as páginas protegidas).

  if (isPublica(pathname) || autenticado) {
    return NextResponse.next()
  }

  // Chamada de API sem sessão e sem token válido: responde 401 em JSON em vez
  // de redirecionar para a tela de login (que não faz sentido para uma API).
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, erro: "Não autorizado. Envie o header Authorization: Bearer <API_TOKEN>." },
      { status: 401 },
    )
  }

  // Não autenticado: redireciona para o login preservando o destino.
  const loginUrl = new URL("/login", request.url)
  const destino = `${pathname}${search}`
  if (destino && destino !== "/") {
    loginUrl.searchParams.set("from", destino)
  }
  return NextResponse.redirect(loginUrl)
}

export const config = {
  /*
   * Aplica a todas as rotas, menos assets internos do Next e arquivos estáticos
   * (imagens, ícones, etc.), que não precisam de verificação de sessão.
   *
   * `/api/backup/restaurar` também fica de fora: ela recebe o arquivo de backup
   * (centenas de MB) e o proxy faz buffer do corpo com um teto de ~10 MB, o que
   * cortaria o arquivo. A rota se protege sozinha com `guardApi` (sessão lida do
   * banco ou API_TOKEN), então continua exigindo login.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|api/backup/restaurar|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|mp3)$).*)",
  ],
}