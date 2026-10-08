import { createHash, randomBytes } from "node:crypto"

import { normalizarFerramentas } from "@/lib/mcp/catalogo"
import { prisma, prismaGlobal } from "@/lib/prisma"
import { workspaceAtualId } from "@/lib/workspace-context"

/**
 * Acesso ao MCP por instância.
 *
 * O MCP vem desligado: só funciona depois que alguém da instância gera um token em
 * Integrações. O token identifica a instância — as ferramentas rodam só nela — e pode ser
 * desativado ou trocado a qualquer momento. Só o hash SHA-256 fica no banco; o token em si
 * aparece uma única vez, na hora de gerar.
 */

export interface McpStatus {
  ativo: boolean
  /** Início do token (ex.: `mcp_1a2b3c4d`), só para reconhecê-lo. */
  prefixo: string
  /** Funções liberadas para este token (nomes de `lib/mcp/catalogo.ts`). */
  ferramentas: string[]
  criadoEm: string
  ultimoUsoEm: string | null
}

const PREFIXO_TOKEN = "mcp_"

function hashDoToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/** Erro de regra (ex.: nenhuma função escolhida): a action mostra a mensagem como está. */
export class McpTokenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "McpTokenError"
  }
}

function ferramentasEscolhidas(valor: unknown): string[] {
  const ferramentas = normalizarFerramentas(valor)
  if (ferramentas.length === 0) throw new McpTokenError("Escolha pelo menos uma função que o MCP poderá executar.")
  return ferramentas
}

/**
 * Gera (ou substitui) o token da instância com as funções escolhidas. O anterior deixa de funcionar
 * na hora. Devolve o token em texto, uma única vez.
 */
export async function gerarTokenMcp(ferramentas: unknown): Promise<string> {
  const liberadas = ferramentasEscolhidas(ferramentas)
  const token = `${PREFIXO_TOKEN}${randomBytes(32).toString("hex")}`
  const dados = {
    tokenHash: hashDoToken(token),
    prefixo: token.slice(0, PREFIXO_TOKEN.length + 8),
    ativo: true,
    ferramentas: liberadas,
    ultimoUsoEm: null,
  }

  await prisma.mcpToken.upsert({
    where: { workspaceId: await workspaceAtualId() },
    create: dados,
    update: dados,
  })
  return token
}

export async function getMcpStatus(): Promise<McpStatus | null> {
  try {
    const row = await prisma.mcpToken.findUnique({ where: { workspaceId: await workspaceAtualId() } })
    if (!row) return null
    return {
      ativo: row.ativo,
      prefixo: row.prefixo,
      ferramentas: normalizarFerramentas(row.ferramentas),
      criadoEm: row.criadoEm.toISOString(),
      ultimoUsoEm: row.ultimoUsoEm?.toISOString() ?? null,
    }
  } catch {
    return null
  }
}

/** Troca as funções liberadas sem gerar outro token (a IA já conectada passa a ver a nova lista na próxima chamada). */
export async function definirFerramentasMcp(ferramentas: unknown): Promise<void> {
  const liberadas = ferramentasEscolhidas(ferramentas)
  await prisma.mcpToken.update({ where: { workspaceId: await workspaceAtualId() }, data: { ferramentas: liberadas } })
}

export async function definirMcpAtivo(ativo: boolean): Promise<void> {
  await prisma.mcpToken.update({ where: { workspaceId: await workspaceAtualId() }, data: { ativo } })
}

/** Remove o token: o MCP desta instância volta a ficar desligado. */
export async function revogarTokenMcp(): Promise<void> {
  await prisma.mcpToken.deleteMany({})
}

export interface McpAcesso {
  workspaceId: string
  /** Funções que este token pode executar. */
  ferramentas: string[]
}

/**
 * Descobre a instância dona de um token (e as funções liberadas), ou `null` se ele não existe,
 * está desativado ou a instância está suspensa. É a única consulta global do MCP: a rota é chamada sem sessão,
 * então o próprio token diz de quem são os dados.
 */
export async function workspaceDoTokenMcp(token: string): Promise<McpAcesso | null> {
  if (!token.startsWith(PREFIXO_TOKEN) || token.length > 200) return null

  const row = await prismaGlobal.mcpToken.findUnique({ where: { tokenHash: hashDoToken(token) } })
  if (!row || !row.ativo) return null
  const workspace = await prismaGlobal.workspace.findUnique({ where: { id: row.workspaceId }, select: { ativo: true } })
  if (!workspace?.ativo) return null

  // Marca o último uso no máximo uma vez por minuto (não vale uma escrita a cada chamada).
  if (!row.ultimoUsoEm || Date.now() - row.ultimoUsoEm.getTime() > 60_000) {
    void prismaGlobal.mcpToken.update({ where: { id: row.id }, data: { ultimoUsoEm: new Date() } }).catch(() => undefined)
  }
  return { workspaceId: row.workspaceId, ferramentas: normalizarFerramentas(row.ferramentas) }
}
