import { z } from "zod"

import { McpEntradaInvalidaError } from "@/lib/mcp/erros"

/**
 * Modelo ÚNICO de paginação das consultas (tools de leitura) do MCP.
 *
 * Regra: cada chamada devolve SOMENTE a página pedida (até 50 itens). As páginas são agrupadas em LOTES de 600
 * itens (12 páginas por lote): `lote` escolhe o lote (padrão 1) e `pagina` escolhe a página dentro dele (padrão 1).
 * Cada consulta é independente: não há estado entre chamadas, e quem pagina é sempre quem chama.
 *
 * Como percorrer tudo: siga `proximo` (`{ lote, pagina }`) com os mesmos filtros até `temProximaPagina: false`.
 * `temProximoLote` / `proximoLote` dizem se ainda existem dados DEPOIS do lote atual.
 *
 * Formato de resposta (igual em TODAS as consultas):
 *   {
 *     lote, pagina, totalRegistros, totalItens (= totalRegistros), totalLotes, totalPaginas, paginasNoLote,
 *     quantidadeNaPagina, tamanhoPagina, tamanhoLote,
 *     temProximaPagina, proximo: { lote, pagina } | null,
 *     temProximoLote, proximoLote,
 *     instrucao, itens: [...]
 *   }
 *
 * Pedir lote/página que não existe é ENTRADA INVÁLIDA (erro legível), nunca uma lista vazia silenciosa.
 * Toda consulta nova do MCP que devolva uma coleção DEVE usar um dos helpers deste arquivo.
 */

export const MCP_TAMANHO_PAGINA = 50
export const MCP_TAMANHO_LOTE = 600
export const MCP_PAGINAS_POR_LOTE = MCP_TAMANHO_LOTE / MCP_TAMANHO_PAGINA

/** Parâmetro `lote` aceito por todas as consultas MCP paginadas. */
export const LOTE_SCHEMA = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe(
    `Lote de resultados; padrão: 1. Cada lote agrupa até ${MCP_TAMANHO_LOTE} itens (${MCP_PAGINAS_POR_LOTE} páginas de ${MCP_TAMANHO_PAGINA}). Use temProximoLote/proximoLote da resposta para saber se há mais.`,
  )

/** Parâmetro `pagina` aceito por todas as consultas MCP paginadas. */
export const PAGINA_SCHEMA = z
  .number()
  .int()
  .min(1)
  .max(MCP_PAGINAS_POR_LOTE)
  .optional()
  .describe(
    `Página dentro do lote (1 a ${MCP_PAGINAS_POR_LOTE}); padrão: 1. A resposta traz SOMENTE esta página (até ${MCP_TAMANHO_PAGINA} itens). Para a seguinte, use o campo proximo (lote e pagina), mantendo os mesmos filtros.`,
  )

export type CursorMcp = { lote?: number | null; pagina?: number | null }

export type ResultadoPaginado<T> = {
  lote: number
  pagina: number
  totalRegistros: number
  /** Mesmo valor de totalRegistros (mantido por compatibilidade). */
  totalItens: number
  totalLotes: number
  totalPaginas: number
  paginasNoLote: number
  quantidadeNaPagina: number
  tamanhoPagina: number
  tamanhoLote: number
  temProximaPagina: boolean
  proximo: { lote: number; pagina: number } | null
  temProximoLote: boolean
  proximoLote: number | null
  instrucao: string
  itens: T[]
}

/** Aceita `{ lote, pagina }` (ou só o número do lote, por compatibilidade) e valida os limites. */
export function normalizarCursor(cursor: CursorMcp | number | undefined | null): { lote: number; pagina: number } {
  const bruto: CursorMcp = typeof cursor === "number" ? { lote: cursor } : (cursor ?? {})
  const lote = bruto.lote ?? 1
  const pagina = bruto.pagina ?? 1
  if (!Number.isInteger(lote) || lote < 1) throw new McpEntradaInvalidaError("lote", `O parâmetro "lote" deve ser um inteiro maior ou igual a 1. Recebido: ${String(bruto.lote)}.`)
  if (!Number.isInteger(pagina) || pagina < 1 || pagina > MCP_PAGINAS_POR_LOTE) {
    throw new McpEntradaInvalidaError("pagina", `O parâmetro "pagina" deve ser um inteiro de 1 a ${MCP_PAGINAS_POR_LOTE}. Recebido: ${String(bruto.pagina)}.`)
  }
  return { lote, pagina }
}

/** Posição inicial (skip) do lote. */
export function inicioDoLote(lote: number): number {
  return (lote - 1) * MCP_TAMANHO_LOTE
}

/** Posição inicial (skip) da página pedida, contada no conjunto inteiro. */
export function inicioDaPagina(lote: number, pagina: number): number {
  return inicioDoLote(lote) + (pagina - 1) * MCP_TAMANHO_PAGINA
}

/** Monta a resposta padrão a partir dos itens DA PÁGINA e do total geral existente. */
export function resultadoPaginado<T>(itensDaPagina: readonly T[], totalRegistros: number, cursor?: CursorMcp | number | null): ResultadoPaginado<T> {
  const { lote, pagina } = normalizarCursor(cursor)
  const totalLotes = Math.max(1, Math.ceil(totalRegistros / MCP_TAMANHO_LOTE))
  const totalPaginas = Math.max(1, Math.ceil(totalRegistros / MCP_TAMANHO_PAGINA))
  const inicio = inicioDaPagina(lote, pagina)

  if (totalRegistros > 0 && inicio >= totalRegistros) {
    throw new McpEntradaInvalidaError(
      inicioDoLote(lote) >= totalRegistros ? "lote" : "pagina",
      inicioDoLote(lote) >= totalRegistros
        ? `O lote ${lote} não existe: para estes filtros há ${totalRegistros} registro(s) em ${totalLotes} lote(s).`
        : `A página ${pagina} do lote ${lote} não existe: para estes filtros há ${totalRegistros} registro(s) (${Math.min(MCP_PAGINAS_POR_LOTE, Math.ceil((totalRegistros - inicioDoLote(lote)) / MCP_TAMANHO_PAGINA))} página(s) neste lote).`,
      `Total de registros: ${totalRegistros}.`,
    )
  }

  const fimDoLote = Math.min(inicioDoLote(lote) + MCP_TAMANHO_LOTE, totalRegistros)
  const paginasNoLote = totalRegistros === 0 ? 0 : Math.ceil((fimDoLote - inicioDoLote(lote)) / MCP_TAMANHO_PAGINA)
  const jaEntregues = inicio + itensDaPagina.length
  const temProximaPagina = jaEntregues < totalRegistros
  const temProximoLote = fimDoLote < totalRegistros
  const proximo = !temProximaPagina ? null : pagina < paginasNoLote ? { lote, pagina: pagina + 1 } : { lote: lote + 1, pagina: 1 }

  let instrucao: string
  if (totalRegistros === 0) instrucao = "Nenhum registro encontrado para estes filtros."
  else if (temProximaPagina) {
    instrucao = `Página ${pagina} de ${paginasNoLote} do lote ${lote} (${jaEntregues} de ${totalRegistros} registros entregues). Para continuar, chame de novo com lote=${proximo!.lote} e pagina=${proximo!.pagina} (mesmos filtros) até temProximaPagina=false.`
  } else instrucao = `Última página: todos os ${totalRegistros} registros existentes já foram entregues.`

  return {
    lote,
    pagina,
    totalRegistros,
    totalItens: totalRegistros,
    totalLotes,
    totalPaginas,
    paginasNoLote,
    quantidadeNaPagina: itensDaPagina.length,
    tamanhoPagina: MCP_TAMANHO_PAGINA,
    tamanhoLote: MCP_TAMANHO_LOTE,
    temProximaPagina,
    proximo,
    temProximoLote,
    proximoLote: temProximoLote ? lote + 1 : null,
    instrucao,
    itens: [...itensDaPagina],
  }
}

/** Para coleções que já estão inteiras em memória: fatia SÓ a página pedida. */
export function paginarEmMemoria<T>(todos: readonly T[], cursor?: CursorMcp | number | null): ResultadoPaginado<T> {
  const { lote, pagina } = normalizarCursor(cursor)
  const inicio = inicioDaPagina(lote, pagina)
  return resultadoPaginado(todos.slice(inicio, inicio + MCP_TAMANHO_PAGINA), todos.length, { lote, pagina })
}

/**
 * Para coleções grandes no banco: conta o total e busca SÓ a página pedida (skip/take de 50),
 * sem carregar o restante.
 */
export async function paginarPorBanco<T>(
  cursor: CursorMcp | number | undefined | null,
  contar: () => Promise<number>,
  buscar: (skip: number, take: number) => Promise<T[]>,
): Promise<ResultadoPaginado<T>> {
  const { lote, pagina } = normalizarCursor(cursor)
  const [total, itens] = await Promise.all([contar(), buscar(inicioDaPagina(lote, pagina), MCP_TAMANHO_PAGINA)])
  return resultadoPaginado(itens, total, { lote, pagina })
}
