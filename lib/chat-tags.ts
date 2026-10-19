/**
 * Etiquetas (tags) do chat. Sem imports de servidor: é usado tanto pela tela quanto pelo serviço.
 *
 * As etiquetas valem para toda a instância: qualquer pessoa com acesso ao chat cria e aplica;
 * renomear, trocar a cor e excluir fica com quem não é usuário padrão (ver `app/actions/chat.ts`).
 */

export const CHAT_TAGS_MAX = 50
export const CHAT_TAG_NOME_MAX = 30
/** Quantas etiquetas um mesmo lead pode ter. */
export const CHAT_TAGS_POR_LEAD_MAX = 10

export const CHAT_TAG_CORES = ["cinza", "vermelho", "laranja", "amarelo", "verde", "azul", "roxo", "rosa"] as const
export type ChatTagCor = (typeof CHAT_TAG_CORES)[number]
export const CHAT_TAG_COR_PADRAO: ChatTagCor = "azul"

/** Classes completas (o Tailwind só gera o que aparece escrito por inteiro). */
export const CHAT_TAG_ESTILOS: Record<ChatTagCor, { rotulo: string; badge: string; ponto: string }> = {
  cinza: { rotulo: "Cinza", badge: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300", ponto: "bg-zinc-500" },
  vermelho: { rotulo: "Vermelho", badge: "bg-red-500/15 text-red-700 dark:text-red-300", ponto: "bg-red-500" },
  laranja: { rotulo: "Laranja", badge: "bg-orange-500/15 text-orange-700 dark:text-orange-300", ponto: "bg-orange-500" },
  amarelo: { rotulo: "Amarelo", badge: "bg-yellow-500/20 text-yellow-800 dark:text-yellow-300", ponto: "bg-yellow-500" },
  verde: { rotulo: "Verde", badge: "bg-green-500/15 text-green-700 dark:text-green-300", ponto: "bg-green-500" },
  azul: { rotulo: "Azul", badge: "bg-blue-500/15 text-blue-700 dark:text-blue-300", ponto: "bg-blue-500" },
  roxo: { rotulo: "Roxo", badge: "bg-purple-500/15 text-purple-700 dark:text-purple-300", ponto: "bg-purple-500" },
  rosa: { rotulo: "Rosa", badge: "bg-pink-500/15 text-pink-700 dark:text-pink-300", ponto: "bg-pink-500" },
}

export interface ChatTag {
  id: string
  nome: string
  cor: ChatTagCor
}

/** Etiqueta com quantos leads a usam (tela de gerenciamento). */
export interface ChatTagComContagem extends ChatTag {
  total: number
}

export function corValida(valor: unknown): ChatTagCor {
  return (CHAT_TAG_CORES as readonly string[]).includes(valor as string) ? (valor as ChatTagCor) : CHAT_TAG_COR_PADRAO
}

/** Tira espaços das pontas e repetidos; mantém maiúsculas e acentos como o usuário digitou. */
export function normalizarNomeTag(bruto: string): string {
  return bruto.replace(/\s+/g, " ").trim().slice(0, CHAT_TAG_NOME_MAX)
}

export function ordenarTags<T extends { nome: string }>(tags: T[]): T[] {
  return [...tags].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }))
}
