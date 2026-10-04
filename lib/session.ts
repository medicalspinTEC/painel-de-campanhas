import { cache } from "react"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { NextResponse } from "next/server"

import { requestHasValidApiToken } from "@/lib/api-auth"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth"
import { podeAcessar, type SecaoKey } from "@/lib/permissoes"
import { prisma } from "@/lib/prisma"
import { toUsuario, type Usuario } from "@/services/users"

/**
 * Usuário logado, lido do BANCO a cada requisição (memoizado por requisição).
 * Devolve `null` sem sessão válida, ou quando o usuário foi desativado/excluído
 * — assim o que o admin altera vale imediatamente, sem esperar o cookie expirar.
 */
export const getCurrentUser = cache(async (): Promise<Usuario | null> => {
  const store = await cookies()
  const id = await verifySessionToken(store.get(SESSION_COOKIE)?.value)
  if (!id) return null
  const row = await prisma.user.findUnique({ where: { id } })
  if (!row || !row.ativo) return null
  return toUsuario(row)
})

/** Erro lançado quando o usuário não tem permissão para a ação. */
export class ForbiddenError extends Error {
  constructor(message = "Você não tem permissão para realizar esta ação.") {
    super(message)
    this.name = "ForbiddenError"
  }
}

// ---------------------------------------------------------------------------
// Páginas (Server Components): redirecionam em vez de lançar erro.
// ---------------------------------------------------------------------------

export async function requireUser(): Promise<Usuario> {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  return user
}

/** Garante acesso à seção; sem permissão, vai para a tela "sem acesso". */
export async function requireSecao(secao: SecaoKey): Promise<Usuario> {
  const user = await requireUser()
  if (!podeAcessar(user, secao)) redirect("/sem-acesso")
  return user
}

/** Páginas exclusivas de admin (ex.: gestão de usuários). */
export async function requireAdminPage(): Promise<Usuario> {
  const user = await requireUser()
  if (user.role !== "admin") redirect("/sem-acesso")
  return user
}

// ---------------------------------------------------------------------------
// Server Actions: lançam erro (a chamada é interrompida antes de tocar nos dados).
// ---------------------------------------------------------------------------

/** Exige login e acesso a QUALQUER uma das seções informadas (admin sempre passa). */
export async function assertSecao(...secoes: SecaoKey[]): Promise<Usuario> {
  const user = await getCurrentUser()
  if (!user) throw new ForbiddenError("Sessão expirada. Faça login novamente.")
  if (user.role === "admin" || secoes.some((s) => podeAcessar(user, s))) return user
  throw new ForbiddenError()
}

export async function assertUsuario(): Promise<Usuario> {
  const user = await getCurrentUser()
  if (!user) throw new ForbiddenError("Sessão expirada. Faça login novamente.")
  return user
}

export async function assertAdmin(): Promise<Usuario> {
  const user = await assertUsuario()
  if (user.role !== "admin") throw new ForbiddenError("Apenas administradores podem realizar esta ação.")
  return user
}

// ---------------------------------------------------------------------------
// Rotas de API (/api/*): aceitam o token estático (integrações) OU a sessão.
// ---------------------------------------------------------------------------

/**
 * Retorna `null` quando liberado, ou a resposta 401/403 a devolver. O token
 * estático de API (`API_TOKEN`) continua com acesso total, como antes; sessão
 * de navegador passa pelas mesmas regras de seção das páginas.
 */
export async function guardApi(...secoes: SecaoKey[]): Promise<NextResponse | null> {
  const h = await headers()
  if (requestHasValidApiToken(h)) return null

  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 })
  if (user.role === "admin" || secoes.some((s) => podeAcessar(user, s))) return null
  return NextResponse.json({ ok: false, erro: "Sem permissão para acessar este recurso." }, { status: 403 })
}
