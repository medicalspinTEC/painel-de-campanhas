import { cache } from "react"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { NextResponse } from "next/server"

import { requestHasValidApiToken } from "@/lib/api-auth"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth"
import { podeAcessar, podeGerenciarUsuarios, temPoder, type PoderKey, type SecaoKey } from "@/lib/permissoes"
import { prismaGlobal } from "@/lib/prisma"
import { toUsuario, type Usuario } from "@/services/users"

/**
 * Usuário logado, lido do BANCO a cada requisição (memoizado por requisição).
 * Devolve `null` sem sessão válida, ou quando o usuário foi desativado/excluído
 * — assim o que o root/admin altera vale imediatamente, sem esperar o cookie expirar.
 */
export const getCurrentUser = cache(async (): Promise<Usuario | null> => {
  const store = await cookies()
  const id = await verifySessionToken(store.get(SESSION_COOKIE)?.value)
  if (!id) return null
  const row = await prismaGlobal.user.findUnique({ where: { id } })
  if (!row || !row.ativo) return null
  // Instância suspensa (admin desativado): perde o acesso na hora, como o próprio admin.
  const workspace = await prismaGlobal.workspace.findUnique({ where: { id: row.workspaceId }, select: { ativo: true } })
  if (!workspace?.ativo) return null
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

/** Tela de Usuários: root, ou admin com ao menos um poder de gestão de usuários. */
export async function requireGestaoUsuarios(): Promise<Usuario> {
  const user = await requireUser()
  if (!podeGerenciarUsuarios(user)) redirect("/sem-acesso")
  return user
}

/** Páginas que dependem de um poder do admin (root sempre passa). */
export async function requirePoder(poder: PoderKey): Promise<Usuario> {
  const user = await requireUser()
  if (!temPoder(user, poder)) redirect("/sem-acesso")
  return user
}

// ---------------------------------------------------------------------------
// Server Actions: lançam erro (a chamada é interrompida antes de tocar nos dados).
// ---------------------------------------------------------------------------

/** Exige login e acesso a QUALQUER uma das seções informadas (root sempre passa). */
export async function assertSecao(...secoes: SecaoKey[]): Promise<Usuario> {
  const user = await getCurrentUser()
  if (!user) throw new ForbiddenError("Sessão expirada. Faça login novamente.")
  if (secoes.some((s) => podeAcessar(user, s))) return user
  throw new ForbiddenError()
}

export async function assertUsuario(): Promise<Usuario> {
  const user = await getCurrentUser()
  if (!user) throw new ForbiddenError("Sessão expirada. Faça login novamente.")
  return user
}

/** Exige um poder específico do admin (root sempre passa). */
export async function assertPoder(poder: PoderKey): Promise<Usuario> {
  const user = await assertUsuario()
  if (!temPoder(user, poder)) throw new ForbiddenError("Você não tem permissão para realizar esta ação.")
  return user
}

/** Exige acesso à gestão de usuários (root, ou admin com algum poder de usuários). */
export async function assertGestaoUsuarios(): Promise<Usuario> {
  const user = await assertUsuario()
  if (!podeGerenciarUsuarios(user)) throw new ForbiddenError("Você não tem permissão para gerenciar usuários.")
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
  if (secoes.some((s) => podeAcessar(user, s))) return null
  return NextResponse.json({ ok: false, erro: "Sem permissão para acessar este recurso." }, { status: 403 })
}
