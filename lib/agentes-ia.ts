/**
 * Constantes do plugin Agentes de IA. Arquivo puro (sem servidor/cliente): usado pelas telas
 * e pelo serviço.
 */

/** "claude" = API da Anthropic; "groq" e "compativel" falam o protocolo da OpenAI (chat/completions). */
export type ProvedorIa = "claude" | "groq" | "compativel"

export const PROVEDOR_PADRAO: ProvedorIa = "claude"

export type ModeloSugerido = { id: string; label: string; dica: string }

export type ProvedorInfo = {
  key: ProvedorIa
  label: string
  /** Endereço base da API; `null` = o usuário informa (provedor genérico). */
  baseUrl: string | null
  modeloPadrao: string
  modelos: readonly ModeloSugerido[]
  chavePlaceholder: string
  chaveAjuda: string
}

export const PROVEDORES: readonly ProvedorInfo[] = [
  {
    key: "claude",
    label: "Claude (Anthropic)",
    baseUrl: "https://api.anthropic.com/v1",
    modeloPadrao: "claude-haiku-5-5",
    modelos: [
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", dica: "Rápido e econômico — bom para atendimento." },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", dica: "Equilibrado entre qualidade e custo." },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5", dica: "O mais capaz; mais caro e mais lento." },
    ],
    chavePlaceholder: "sk-ant-...",
    chaveAjuda: "Crie a chave em console.anthropic.com.",
  },
  {
    key: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    modeloPadrao: "llama-3.3-70b-versatile",
    modelos: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile", dica: "Boa qualidade geral e muito rápido." },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant", dica: "O mais leve e rápido; bom para testes." },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", dica: "Modelo aberto grande, bom raciocínio." },
      { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", dica: "Modelo aberto menor e rápido." },
    ],
    chavePlaceholder: "gsk_...",
    chaveAjuda: "Crie a chave em console.groq.com (há plano gratuito, útil para testes).",
  },
  {
    key: "compativel",
    label: "Outro (compatível com OpenAI)",
    baseUrl: null,
    modeloPadrao: "",
    modelos: [],
    chavePlaceholder: "Chave de API do provedor",
    chaveAjuda:
      "Serve para OpenAI, OpenRouter, Together, Ollama com proxy etc. Informe o endereço base (ex.: https://api.openai.com/v1) e o id do modelo.",
  },
]

export function infoDoProvedor(key: string): ProvedorInfo {
  return PROVEDORES.find((p) => p.key === key) ?? PROVEDORES[0]
}

export const LIMITE_NOME_AGENTE = 80
export const LIMITE_PROMPT_AGENTE = 8000

export const PROMPT_EXEMPLO =
  "Você é a assistente virtual da empresa. Atenda com educação e objetividade, em português do Brasil, em mensagens curtas. " +
  "Tire dúvidas sobre os produtos e serviços. Se o cliente pedir algo que você não sabe responder, diga que um atendente humano vai ajudar."

/** Reativação automática: de 1 minuto a 30 dias. */
export const REATIVACAO_MIN_MINUTOS = 1
export const REATIVACAO_MAX_MINUTOS = 30 * 24 * 60

export type UnidadeTempo = "minutos" | "horas" | "dias"

export const UNIDADES_TEMPO: readonly { key: UnidadeTempo; label: string; minutos: number }[] = [
  { key: "minutos", label: "Minutos", minutos: 1 },
  { key: "horas", label: "Horas", minutos: 60 },
  { key: "dias", label: "Dias", minutos: 24 * 60 },
]

/** Escolhe a maior unidade que divide o valor exatamente (90 min → 90 minutos; 120 → 2 horas). */
export function separarTempo(minutos: number): { valor: number; unidade: UnidadeTempo } {
  for (const u of [...UNIDADES_TEMPO].reverse()) {
    if (minutos % u.minutos === 0) return { valor: minutos / u.minutos, unidade: u.key }
  }
  return { valor: minutos, unidade: "minutos" }
}

export function descreverTempo(minutos: number): string {
  const { valor, unidade } = separarTempo(minutos)
  const nomes = { minutos: ["minuto", "minutos"], horas: ["hora", "horas"], dias: ["dia", "dias"] } as const
  return `${valor} ${nomes[unidade][valor === 1 ? 0 : 1]}`
}
