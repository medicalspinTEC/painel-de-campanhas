import { createHash, randomBytes } from "node:crypto"

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
  criadoEm: string
  ultimoUsoEm: string | null
}

const PREFIXO_TOKEN = "mcp_"

function hashDoToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/** Gera (ou substitui) o token da instância. O anterior deixa de funcionar na hora. Devolve o token em texto, uma única vez. */
export async function gerarTokenMcp(): Promise<string> {
  const token = `${PREFIXO_TOKEN}${randomBytes(32).toString("hex")}`
  const dados = { tokenHash: hashDoToken(token), prefixo: token.slice(0, PREFIXO_TOKEN.length + 8), ativo: true, ultimoUsoEm: null }

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
      criadoEm: row.criadoEm.toISOString(),
      ultimoUsoEm: row.ultimoUsoEm?.toISOString() ?? null,
    }
  } catch {
    return null
  }
}

export async function definirMcpAtivo(ativo: boolean): Promise<void> {
  await prisma.mcpToken.update({ where: { workspaceId: await workspaceAtualId() }, data: { ativo } })
}

/** Remove o token: o MCP desta instância volta a ficar desligado. */
export async function revogarTokenMcp(): Promise<void> {
  await prisma.mcpToken.deleteMany({})
}

/**
 * Descobre a instância dona de um token, ou `null` se ele não existe, está desativado ou a
 * instância está suspensa. É a única consulta global do MCP: a rota é chamada sem sessão,
 * então o próprio token diz de quem são os dados.
 */
export async function workspaceDoTokenMcp(token: string): Promise<string | null> {
  if (!token.startsWith(PREFIXO_TOKEN) || token.length > 200) return null

  const row = await prismaGlobal.mcpToken.findUnique({ where: { tokenHash: hashDoToken(token) } })
  if (!row || !row.ativo) return null
  const workspace = await prismaGlobal.workspace.findUnique({ where: { id: row.workspaceId }, select: { ativo: true } })
  if (!workspace?.ativo) return null

  // Marca o último uso no máximo uma vez por minuto (não vale uma escrita a cada chamada).
  if (!row.ultimoUsoEm || Date.now() - row.ultimoUsoEm.getTime() > 60_000) {
    void prismaGlobal.mcpToken.update({ where: { id: row.id }, data: { ultimoUsoEm: new Date() } }).catch(() => undefined)
  }
  return row.workspaceId
}
