/**
 * Funis de vendas (plugin CRM). Sem imports de servidor: é usado tanto pela tela quanto pelo serviço.
 *
 * Um funil é uma lista ordenada de etapas. Cada lead pode estar em vários funis, em uma etapa de cada.
 * Etapas do tipo "ganho" e "perdido" encerram o negócio e entram na conversão do funil.
 */
import { CHAT_TAG_CORES, CHAT_TAG_ESTILOS, corValida, type ChatTagCor } from "@/lib/chat-tags"

export const FUNIS_MAX = 10
export const FUNIL_NOME_MAX = 60
export const FUNIL_DESCRICAO_MAX = 200
export const FUNIL_ETAPAS_MIN = 2
export const FUNIL_ETAPAS_MAX = 12
export const FUNIL_ETAPA_NOME_MAX = 40
/** Máximo de cartões carregados por coluna (o total real vem em `totais`). */
export const FUNIL_LIMITE_POR_COLUNA = 100
/** Valor estimado máximo de um negócio (evita lixo/overflow nos totais). */
export const FUNIL_VALOR_MAX = 1_000_000_000_000

export const FUNIL_ETAPA_TIPOS = ["aberta", "ganho", "perdido"] as const
export type FunilEtapaTipo = (typeof FUNIL_ETAPA_TIPOS)[number]

export const FUNIL_TIPO_ROTULO: Record<FunilEtapaTipo, string> = {
  aberta: "Em andamento",
  ganho: "Ganho",
  perdido: "Perdido",
}

export const FUNIL_CORES = CHAT_TAG_CORES
export type FunilCor = ChatTagCor
export const FUNIL_COR_ESTILOS = CHAT_TAG_ESTILOS
export const funilCorValida = corValida

export function funilTipoValido(valor: unknown): FunilEtapaTipo {
  return (FUNIL_ETAPA_TIPOS as readonly string[]).includes(valor as string) ? (valor as FunilEtapaTipo) : "aberta"
}

/** Etapas criadas junto com um funil novo (a equipe renomeia, reordena ou remove depois). */
export const FUNIL_ETAPAS_PADRAO: ReadonlyArray<{ nome: string; cor: FunilCor; tipo: FunilEtapaTipo }> = [
  { nome: "Novo", cor: "cinza", tipo: "aberta" },
  { nome: "Qualificação", cor: "azul", tipo: "aberta" },
  { nome: "Proposta", cor: "amarelo", tipo: "aberta" },
  { nome: "Negociação", cor: "laranja", tipo: "aberta" },
  { nome: "Ganho", cor: "verde", tipo: "ganho" },
  { nome: "Perdido", cor: "vermelho", tipo: "perdido" },
]

export type FunilEtapaItem = {
  id: string
  nome: string
  cor: FunilCor
  tipo: FunilEtapaTipo
  ordem: number
}

export type FunilResumo = {
  id: string
  nome: string
  descricao: string | null
  ativo: boolean
  totalLeads: number
  etapas: FunilEtapaItem[]
}

export type FunilCartao = {
  /** Id do vínculo lead↔funil. */
  id: string
  leadId: string
  etapaId: string
  nome: string
  telefone: string
  produto: string
  marca: string
  valor: number | null
  movidoEm: string
}

export type FunilTotalEtapa = { total: number; valor: number }

export type FunilBoardData = {
  funil: FunilResumo
  leads: FunilCartao[]
  /** Total real e soma dos valores por etapa (o quadro só carrega parte dos cartões). */
  totais: Record<string, FunilTotalEtapa>
  limitePorColuna: number
  /** Resumo do funil: quantos ganhos/perdidos e valor em aberto/ganho. */
  resumo: {
    emAndamento: number
    ganhos: number
    perdidos: number
    valorEmAndamento: number
    valorGanho: number
    /** Ganhos ÷ (ganhos + perdidos), em %. Nulo enquanto nenhum negócio foi encerrado. */
    conversao: number | null
  }
}

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })

export function formatarValorFunil(valor: number): string {
  return moeda.format(valor)
}

/** Converte o texto digitado ("1.500,50", "R$ 300", "") em número. Vazio = sem valor; inválido = NaN. */
export function lerValorFunil(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.-]/g, "").trim()
  if (!limpo) return null
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo
  const numero = Number(normalizado)
  return Number.isFinite(numero) ? numero : Number.NaN
}
