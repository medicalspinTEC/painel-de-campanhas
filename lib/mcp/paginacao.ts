import { z } from "zod"

/**
 * Modelo ÚNICO de paginação das consultas (tools de leitura) do MCP.
 *
 * Regra: cada chamada devolve no máximo um LOTE de 600 itens, dividido em PÁGINAS de 50 itens
 * (até 12 páginas por lote). Quando o lote enche e ainda há dados, a resposta traz
 * `temProximoLote: true` e `proximoLote`: basta chamar a mesma consulta de novo com `lote = proximoLote`
 * (mantendo os mesmos filtros) para receber os próximos 600, e assim até `temProximoLote: false`,
 * quando todos os dados existentes já foram retornados.
 *
 * Formato de resposta (igual em TODAS as consultas):
 *   {
 *     lote, totalLotes, totalItens, quantidadeNoLote, tamanhoLote, tamanhoPagina,
 *     temProximoLote, proximoLote, instrucao,
 *     paginas: [{ pagina, quantidade, itens: [...] }, ...]
 *   }
 *
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
    `Lote de resultados; padrão: 1. Cada lote traz até ${MCP_TAMANHO_LOTE} itens divididos em páginas de ${MCP_TAMANHO_PAGINA}. Se a resposta indicar temProximoLote=true, chame de novo com lote=proximoLote até receber todos os dados.`,
  )

export type PaginaMcp<T> = { pagina: number; quantidade: number; itens: T[] }

export type ResultadoPaginado<T> = {
  lote: number
  totalLotes: number
  totalItens: number
  quantidadeNoLote: number
  tamanhoLote: number
  tamanhoPagina: number
  temProximoLote: boolean
  proximoLote: number | null
  instrucao: string
  paginas: PaginaMcp<T>[]
}

export function normalizarLote(lote: number | undefined | null): number {
  return Number.isInteger(lote) && (lote as number) >= 1 ? (lote as number) : 1
}

/** Posição inicial (skip) do lote, para consultas no banco. */
export function inicioDoLote(lote: number): number {
  return (lote - 1) * MCP_TAMANHO_LOTE
}

/** Divide os itens de UM lote em páginas de 50, numeradas a partir de 1 dentro do lote. */
export function dividirEmPaginas<T>(itensDoLote: readonly T[]): PaginaMcp<T>[] {
  const paginas: PaginaMcp<T>[] = []
  for (let i = 0; i < itensDoLote.length; i += MCP_TAMANHO_PAGINA) {
    const itens = itensDoLote.slice(i, i + MCP_TAMANHO_PAGINA)
    paginas.push({ pagina: paginas.length + 1, quantidade: itens.length, itens })
  }
  return paginas
}

/** Monta a resposta padrão a partir dos itens do lote e do total geral existente. */
export function resultadoPaginado<T>(itensDoLote: readonly T[], totalItens: number, lote: number): ResultadoPaginado<T> {
  const totalLotes = Math.max(1, Math.ceil(totalItens / MCP_TAMANHO_LOTE))
  const jaEntregues = inicioDoLote(lote) + itensDoLote.length
  const temProximoLote = jaEntregues < totalItens
  const proximoLote = temProximoLote ? lote + 1 : null

  let instrucao: string
  if (totalItens === 0) {
    instrucao = "Nenhum item encontrado."
  } else if (itensDoLote.length === 0) {
    instrucao = `O lote ${lote} está fora do intervalo: existem ${totalLotes} lote(s) para estes filtros.`
  } else if (temProximoLote) {
    instrucao = `Lote ${lote} de ${totalLotes} entregue (${jaEntregues} de ${totalItens} itens). Ainda há dados: chame de novo com lote=${proximoLote} (mesmos filtros) até temProximoLote=false.`
  } else {
    instrucao = `Lote ${lote} de ${totalLotes} entregue. Todos os ${totalItens} itens existentes já foram retornados.`
  }

  return {
    lote,
    totalLotes,
    totalItens,
    quantidadeNoLote: itensDoLote.length,
    tamanhoLote: MCP_TAMANHO_LOTE,
    tamanhoPagina: MCP_TAMANHO_PAGINA,
    temProximoLote,
    proximoLote,
    instrucao,
    paginas: dividirEmPaginas(itensDoLote),
  }
}

/** Para coleções que já estão inteiras em memória: fatia o lote pedido e monta a resposta. */
export function paginarEmMemoria<T>(todos: readonly T[], lote?: number | null): ResultadoPaginado<T> {
  const loteAtual = normalizarLote(lote)
  const inicio = inicioDoLote(loteAtual)
  return resultadoPaginado(todos.slice(inicio, inicio + MCP_TAMANHO_LOTE), todos.length, loteAtual)
}

/**
 * Para coleções grandes no banco: conta o total e busca SÓ o lote pedido (skip/take de 600),
 * sem carregar o restante.
 */
export async function paginarPorBanco<T>(
  lote: number | undefined | null,
  contar: () => Promise<number>,
  buscar: (skip: number, take: number) => Promise<T[]>,
): Promise<ResultadoPaginado<T>> {
  const loteAtual = normalizarLote(lote)
  const [total, itens] = await Promise.all([contar(), buscar(inicioDoLote(loteAtual), MCP_TAMANHO_LOTE)])
  return resultadoPaginado(itens, total, loteAtual)
}
