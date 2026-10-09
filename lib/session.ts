import { cache } from "react"
import { cookies, headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { NextResponse } from "next/server"

import { requestHasValidApiToken } from "@/lib/api-auth"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth"
import { podeAcessar, podeGerenciarUsuarios, temPoder, type PoderKey, type SecaoKey } from "@/lib/permissoes"
import { mensagemPluginDesativado, SECAO_PLUGIN } from "@/lib/plugins"
import { prismaGlobal } from "@/lib/prisma"
import { getPluginsAtivos } from "@/services/settings"
import { toUsuario, type Usuario } from "@/services/users"

/**
 * Instância ativa? Guardado por poucos segundos: o usuário continua sendo lido do banco a cada
 * requisição (papel, seções e status valem na hora), e só esta checagem — que quase nunca muda —
 * deixa de custar uma ida ao banco a cada troca de página. Suspender uma instância vale em até 5 s.
 */
const WORKSPACE_ATIVO_TTL_MS = 5_000
const workspaceAtivoCache = new Map<string, { ativo: boolean; expira: number }>()

async function workspaceEstaAtivo(workspaceId: string): Promise<boolean> {
  const agora = Date.now()
  const guardado = workspaceAtivoCache.get(workspaceId)
  if (guardado && guardado.expira > agora) return guardado.ativo
  const workspace = await prismaGlobal.workspace.findUnique({ where: { id: workspaceId }, select: { ativo: true } })
  const ativo = Boolean(workspace?.ativo)
  workspaceAtivoCache.set(workspaceId, { ativo, expira: agora + WORKSPACE_ATIVO_TTL_MS })
  return ativo
}

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
  if (!(await workspaceEstaAtivo(row.workspaceId))) return null
  return toUsuario(row)
})

/** Erro lançado quando o usuário não tem permissão para a ação. */
export class ForbiddenError extends Error {
  constructor(message = "Você não tem permissão para realizar esta ação.") {
    super(message)
    this.name = "ForbiddenError"
  }
}

/**
 * Seções ligadas a um plugin (Chat, Kanban, Assistente, No Code) só existem com ele ativo.
 * Plugin desativado = a seção some de verdade: a página dá 404, a action é recusada e a API
 * responde 403 — não basta esconder o item do menu. Seções sem plugin ficam sempre disponíveis.
 */
async function secaoDisponivel(secao: SecaoKey): Promise<boolean> {
  const plugin = SECAO_PLUGIN[secao]
  if (!plugin) return true
  return (await getPluginsAtivos())[plugin]
}

/** Mensagem para quando o usuário tem acesso à seção, mas o plugin dela está desativado. */
function mensagemSecaoIndisponivel(secoes: SecaoKey[]): string {
  const plugin = secoes.map((s) => SECAO_PLUGIN[s]).find((p) => p !== undefined)
  return plugin ? mensagemPluginDesativado(plugin) : "Você não tem permissão para realizar esta ação."
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
  // Plugin desativado: a página deixa de existir (404), mesmo para quem tem a seção liberada.
  if (!(await secaoDisponivel(secao))) notFound()
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
  const permitidas = secoes.filter((s) => podeAcessar(user, s))
  if (permitidas.length === 0) throw new ForbiddenError()
  // Vale a primeira seção permitida cujo plugin (se houver) está ativo.
  for (const secao of permitidas) {
    if (await secaoDisponivel(secao)) return user
  }
  throw new ForbiddenError(mensagemSecaoIndisponivel(permitidas))
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
  const permitidas = secoes.filter((s) => podeAcessar(user, s))
  if (permitidas.length === 0) {
    return NextResponse.json({ ok: false, erro: "Sem permissão para acessar este recurso." }, { status: 403 })
  }
  for (const secao of permitidas) {
    if (await secaoDisponivel(secao)) return null
  }
  return NextResponse.json({ ok: false, erro: mensagemSecaoIndisponivel(permitidas) }, { status: 403 })
}
