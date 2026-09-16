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

/** Filtros aceitos por `listAppLogs` — todos opcionais e combináveis. */
export interface AppLogFiltros {
  nivel?: AppLogNivel
  origem?: string
  /** Início do período (inclusive). */
  de?: Date
  /** Fim do período (inclusive). */
  ate?: Date
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
 * Lista os AppLogs mais recentes para a página /logs, com filtros opcionais
 * (nível, origem, período). Os filtros são aplicados na própria consulta —
 * não sobre uma lista já carregada — para que uma busca por um período antigo
 * também funcione, e não só sobre os `limit` registros mais recentes.
 *
 * Sempre limitada por `limit` (padrão 500): tanto para não saturar a
 * serialização do RSC quanto para que a exportação em JSON (que usa
 * exatamente estes registros) nunca dispare uma exportação sem limite —
 * ver botão "Exportar JSON" na página de Logs.
 */
export async function listAppLogs(filtros: AppLogFiltros = {}, limit = 500): Promise<AppLogRow[]> {
  const logs = await prisma.appLog.findMany({
    where: {
      ...(filtros.nivel ? { nivel: filtros.nivel } : {}),
      ...(filtros.origem ? { origem: filtros.origem } : {}),
      ...(filtros.de || filtros.ate
        ? {
            data: {
              ...(filtros.de ? { gte: filtros.de } : {}),
              ...(filtros.ate ? { lte: filtros.ate } : {}),
            },
          }
        : {}),
    },
    orderBy: { data: "desc" },
    take: limit,
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

/** Origens distintas já registradas, para popular o filtro de origem na UI. */
export async function listAppLogOrigens(): Promise<string[]> {
  const linhas = await prisma.appLog.findMany({
    distinct: ["origem"],
    select: { origem: true },
    orderBy: { origem: "asc" },
  })
  return linhas.map((l) => l.origem)
}

/**
 * Contagens gerais (todo o histórico, sem filtro) usadas nos KPIs do topo da
 * página de Logs — para que aplicar um filtro na tabela/exportação não altere
 * os números do painel.
 */
export async function getAppLogStats(): Promise<{ erros: number; avisos: number }> {
  const [erros, avisos] = await Promise.all([
    prisma.appLog.count({ where: { nivel: { in: ["erro", "critico"] } } }),
    prisma.appLog.count({ where: { nivel: "aviso" } }),
  ])
  return { erros, avisos }
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
