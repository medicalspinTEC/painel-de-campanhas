"use server"

import { revalidatePath } from "next/cache"

import { assertSecao } from "@/lib/session"
import { recordAppLog } from "@/services/app-logs"
import { definirFerramentasMcp, definirMcpAtivo, gerarTokenMcp, McpTokenError, revogarTokenMcp } from "@/services/mcp-token"

export type McpAction = { ok: boolean; message: string }

async function executar(origem: string, falha: string, fn: () => Promise<McpAction>): Promise<McpAction> {
  await assertSecao("integracoes")
  try {
    const resultado = await fn()
    revalidatePath("/integracoes")
    return resultado
  } catch (error) {
    if (error instanceof McpTokenError) return { ok: false, message: error.message }
    await recordAppLog({ nivel: "erro", origem: "mcp", mensagem: `${origem}: ${falha}`, detalhes: error })
    return { ok: false, message: falha }
  }
}

/**
 * Gera (ou troca) o token do MCP desta instância, já com as funções escolhidas na tela.
 * O texto do token só volta aqui, uma vez.
 */
export async function gerarTokenMcpAction(ferramentas: string[]): Promise<McpAction & { token?: string }> {
  let token: string | undefined
  const resultado = await executar("gerar token", "Não foi possível gerar o token do MCP.", async () => {
    token = await gerarTokenMcp(ferramentas)
    return { ok: true, message: "Token do MCP gerado. Copie agora: ele não será mostrado de novo." }
  })
  return resultado.ok ? { ...resultado, token } : resultado
}

/** Troca as funções liberadas do token atual, sem gerar outro token. */
export async function definirFerramentasMcpAction(ferramentas: string[]): Promise<McpAction> {
  return executar("salvar funções", "Não foi possível salvar as funções do MCP.", async () => {
    await definirFerramentasMcp(ferramentas)
    return { ok: true, message: "Funções do MCP atualizadas." }
  })
}

export async function definirMcpAtivoAction(ativo: boolean): Promise<McpAction> {
  return executar("alterar status", "Não foi possível alterar o status do MCP.", async () => {
    await definirMcpAtivo(Boolean(ativo))
    return { ok: true, message: ativo ? "MCP ativado." : "MCP desativado." }
  })
}

export async function revogarTokenMcpAction(): Promise<McpAction> {
  return executar("remover token", "Não foi possível remover o token do MCP.", async () => {
    await revogarTokenMcp()
    return { ok: true, message: "Token removido. O MCP desta instância está desligado." }
  })
}
