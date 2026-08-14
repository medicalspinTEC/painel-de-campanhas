import { NextResponse, type NextRequest } from "next/server"

import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth"

/**
 * Proteção de rotas (equivalente ao antigo middleware no Next 16).
 *
 * Tudo exige sessão, exceto a própria tela de login e os endpoints públicos de
 * automação (`/api/webhook/entrada` e `/api/cron`), que são chamados por
 * serviços externos e se autenticam por conta própria.
 */

// Rotas acessíveis sem sessão.
const ROTAS_PUBLICAS = ["/login", "/api/webhook/entrada", "/api/cron"]

function isPublica(pathname: string): boolean {
  return ROTAS_PUBLICAS.some((rota) => pathname === rota || pathname.startsWith(`${rota}/`))
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  const token = request.cookies.get(SESSION_COOKIE)?.value
  const autenticado = Boolean(await verifySessionToken(token))

  // Usuário logado tentando abrir /login: manda para o dashboard.
  if (pathname === "/login" && autenticado) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  if (isPublica(pathname) || autenticado) {
    return NextResponse.next()
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
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)"],
}
