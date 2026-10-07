/**
 * Templates de mensagem do chat (atalho "/nome"). Sem imports de servidor: é usado
 * tanto pela tela quanto pelo serviço.
 */

export const CHAT_TEMPLATES_MAX = 10
export const CHAT_TEMPLATE_NOME_MAX = 30
export const CHAT_TEMPLATE_TEXTO_MAX = 4096

export interface ChatTemplate {
  id: string
  nome: string
  texto: string
}

/**
 * Normaliza o nome digitado: tira a barra inicial, passa para minúsculo, troca espaços
 * por hífen e remove acentos/símbolos. Ex.: "/Boas Vindas" → "boas-vindas".
 */
export function normalizarNomeTemplate(bruto: string): string {
  return bruto
    .trim()
    .replace(/^\/+/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, CHAT_TEMPLATE_NOME_MAX)
}

/**
 * Se o texto termina num "/alguma-coisa" (início da mensagem ou depois de espaço/quebra de
 * linha), devolve o trecho digitado e onde ele começa. Usado para abrir o menu de templates.
 */
export function gatilhoDeTemplate(texto: string): { consulta: string; inicio: number } | null {
  const achado = /(^|\s)\/([a-z0-9_-]*)$/i.exec(texto)
  if (!achado) return null
  return { consulta: achado[2].toLowerCase(), inicio: achado.index + achado[1].length }
}
