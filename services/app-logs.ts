import { prisma } from "@/lib/prisma"
import type { AppLogNivel } from "@/lib/generated/prisma/client"

export type { AppLogNivel }

export interface AppLogInput {
  nivel?: AppLogNivel
  origem: string
  mensagem: string
  detalhes?: string | unknown
}

export interface AppLogRow {
  id: string
  nivel: AppLogNivel
  origem: string
  mensagem: string
  detalhes: string | null
  data: string
}

/**
 * Grava um log de sistema no banco.
 *
 * Nunca lança exceção: se o banco estiver indisponível o erro vai apenas para
 * o console, para não mascarar o erro original que estava sendo registrado.
 */
export async function recordAppLog(input: AppLogInput): Promise<void> {
  const detalhesStr = formatDetalhes(input.detalhes)

  try {
    await prisma.appLog.create({
      data: {
        nivel: input.nivel ?? "erro",
        origem: input.origem,
        mensagem: input.mensagem,
        detalhes: detalhesStr,
      },
    })
  } catch (err) {
    // Falha silenciosa — logar o erro do logger causaria recursão.
    console.error("[app-logs] Não foi possível gravar AppLog:", err)
  }
}

/**
 * Lista os AppLogs mais recentes para a página /logs.
 * Limita a 200 registros para não saturar a serialização do RSC.
 */
export async function listAppLogs(): Promise<AppLogRow[]> {
  const logs = await prisma.appLog.findMany({
    orderBy: { data: "desc" },
    take: 200,
  })

  return logs.map((l) => ({
    id: l.id,
    nivel: l.nivel,
    origem: l.origem,
    mensagem: l.mensagem,
    detalhes: l.detalhes,
    data: l.data.toISOString(),
  }))
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function formatDetalhes(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === "string") return value.length > 2000 ? value.slice(0, 2000) + "…" : value
  if (value instanceof Error) {
    const stack = value.stack ?? value.message
    return stack.length > 2000 ? stack.slice(0, 2000) + "…" : stack
  }
  try {
    const json = JSON.stringify(value, null, 2)
    return json.length > 2000 ? json.slice(0, 2000) + "…" : json
  } catch {
    return String(value)
  }
}
