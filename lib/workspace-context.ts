/**
 * Contexto de instância (workspace): de qual instância é a operação em curso.
 *
 * Toda consulta feita por `prisma` (lib/prisma.ts) é filtrada pela instância
 * resolvida aqui. A ordem é:
 *  1. contexto explícito (`runInWorkspace`) — rotinas em segundo plano, webhooks
 *     de entrada e tarefas desacopladas da requisição;
 *  2. token estático de API (`API_TOKEN`) — acessa só a instância principal;
 *  3. sessão (cookie) — a instância do usuário logado.
 *
 * Se nada resolver, a consulta FALHA (nunca roda sem filtro): é melhor um erro
 * do que misturar dados de instâncias.
 */
import { AsyncLocalStorage } from "node:async_hooks"
import { cookies, headers } from "next/headers"

import { requestHasValidApiToken } from "@/lib/api-auth"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth"
import { prismaGlobal } from "@/lib/prisma-base"

type Contexto = { workspaceId: string }

const armazenamento = new AsyncLocalStorage<Contexto>()

export class SemWorkspaceError extends Error {
  constructor(message = "Não foi possível identificar a instância desta operação.") {
    super(message)
    this.name = "SemWorkspaceError"
  }
}

/** Executa `fn` (e tudo que ela disparar) dentro da instância informada. */
export function runInWorkspace<T>(workspaceId: string, fn: () => T): T {
  return armazenamento.run({ workspaceId }, fn)
}

// ---------------------------------------------------------------------------
// Resolução pela requisição (cache curto para não consultar o banco a cada query)
// ---------------------------------------------------------------------------

const TTL_MS = 5_000
const MAX_ENTRADAS = 500
const cacheSessao = new Map<string, { workspaceId: string | null; ate: number }>()
let cachePrincipal: { id: string | null; ate: number } | null = null

/** Id da instância principal (a do Root). */
export async function workspacePrincipalId(): Promise<string | null> {
  const agora = Date.now()
  if (cachePrincipal && cachePrincipal.ate > agora) return cachePrincipal.id
  const row = await prismaGlobal.workspace.findFirst({ where: { principal: true, ativo: true }, select: { id: true } })
  cachePrincipal = { id: row?.id ?? null, ate: agora + 30_000 }
  return cachePrincipal.id
}

/** Instância de um usuário ativo, ou `null` se o usuário ou a instância estiverem inativos. */
async function workspaceDoUsuario(userId: string): Promise<string | null> {
  const user = await prismaGlobal.user.findUnique({ where: { id: userId }, select: { ativo: true, workspaceId: true } })
  if (!user || !user.ativo) return null
  const ws = await prismaGlobal.workspace.findUnique({ where: { id: user.workspaceId }, select: { ativo: true } })
  return ws?.ativo ? user.workspaceId : null
}

async function workspaceDaRequisicao(): Promise<string | null> {
  let h: Headers
  let token: string | undefined
  try {
    h = await headers()
    token = (await cookies()).get(SESSION_COOKIE)?.value
  } catch {
    return null // fora de uma requisição (rotina em segundo plano sem contexto)
  }

  if (requestHasValidApiToken(h)) return workspacePrincipalId()
  if (!token) return null

  const agora = Date.now()
  const guardado = cacheSessao.get(token)
  if (guardado && guardado.ate > agora) return guardado.workspaceId

  const userId = await verifySessionToken(token)
  const workspaceId = userId ? await workspaceDoUsuario(userId) : null
  if (cacheSessao.size >= MAX_ENTRADAS) cacheSessao.clear()
  cacheSessao.set(token, { workspaceId, ate: agora + TTL_MS })
  return workspaceId
}

/** Instância da operação atual, ou `null` quando não há como saber. */
export async function tentarWorkspaceId(): Promise<string | null> {
  return armazenamento.getStore()?.workspaceId ?? (await workspaceDaRequisicao())
}

/** Instância da operação atual. Lança erro se não for possível identificá-la. */
export async function workspaceAtualId(): Promise<string> {
  const id = await tentarWorkspaceId()
  if (!id) throw new SemWorkspaceError()
  return id
}

/**
 * Para tarefas que continuam depois que a requisição termina (`after`, `void fn()`):
 * captura a instância AGORA e devolve um executor que roda `fn` dentro dela.
 */
export async function capturarWorkspace(): Promise<<T>(fn: () => T) => T> {
  const id = await workspaceAtualId()
  return <T>(fn: () => T) => runInWorkspace(id, fn)
}

/** Percorre as instâncias ativas, uma de cada vez, isolando falhas. */
export async function paraCadaWorkspace<T>(
  fn: (workspaceId: string) => Promise<T>,
  aoFalhar?: (workspaceId: string, erro: unknown) => void,
): Promise<T[]> {
  const lista = await prismaGlobal.workspace.findMany({ where: { ativo: true }, select: { id: true }, orderBy: { criadoEm: "asc" } })
  const resultados: T[] = []
  for (const { id } of lista) {
    try {
      resultados.push(await runInWorkspace(id, () => fn(id)))
    } catch (erro) {
      if (aoFalhar) aoFalhar(id, erro)
      else console.error(`[v0] falha na instância ${id}:`, erro)
    }
  }
  return resultados
}
