/** Pastas de campanhas. Sem imports de servidor: usado pela tela e pelo serviço. */

export const PASTA_NOME_MAX = 40
export const PASTAS_MAX = 100

export interface CampanhaPasta {
  id: string
  nome: string
}

/** Pasta com quantas campanhas ela tem (tela de Campanhas). */
export interface CampanhaPastaComContagem extends CampanhaPasta {
  total: number
}

/** Tira espaços das pontas e repetidos; mantém maiúsculas e acentos como o usuário digitou. */
export function normalizarNomePasta(bruto: string): string {
  return bruto.replace(/\s+/g, " ").trim().slice(0, PASTA_NOME_MAX)
}

export function ordenarPastas<T extends { nome: string }>(pastas: T[]): T[] {
  return [...pastas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }))
}
