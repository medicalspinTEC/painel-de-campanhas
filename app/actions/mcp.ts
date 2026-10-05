"use server"

import { revalidatePath } from "next/cache"

import { assertSecao } from "@/lib/session"
import { recordAppLog } from "@/services/app-logs"
import { definirMcpAtivo, gerarTokenMcp, revogarTokenMcp } from "@/services/mcp-token"

export type McpAction = { ok: boolean; message: string }

async function executar(origem: string, falha: string, fn: () => Promise<McpAction>): Promise<McpAction> {
  await assertSecao("integracoes")
  try {
    const resultado = await fn()
    revalidatePath("/integracoes")
    return resultado
  } catch (error) {
    await recordAppLog({ nivel: "erro", origem: "mcp", mensagem: `${origem}: ${falha}`, detalhes: error })
    return { ok: false, message: falha }
  }
}

/** Gera (ou troca) o token do MCP desta instância. O texto do token só volta aqui, uma vez. */
export async function gerarTokenMcpAction(): Promise<McpAction & { token?: string }> {
  let token: string | undefined
  const resultado = await executar("gerar token", "Não foi possível gerar o token do MCP.", async () => {
    token = await gerarTokenMcp()
    return { ok: true, message: "Token do MCP gerado. Copie agora: ele não será mostrado de novo." }
  })
  return resultado.ok ? { ...resultado, token } : resultado
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
