export type LeadStatus = "novo" | "em_campanha" | "respondeu" | "qualificado" | "encerrado"

export type CampaignStatus = "ativa" | "pausada" | "encerrada" | "rascunho"

export type EventType =
  | "mensagem_enviada"
  | "falha"
  | "resposta"
  | "qualificado"
  | "campanha_iniciada"
  | "campanha_encerrada"

export type Produto = "Consórcio Imobiliário" | "Consórcio de Veículos" | "Seguro de Vida" | "Financiamento" | "Previdência"

export type Marca = "Ápice" | "NovaVida" | "Prisma" | "Vértice"

export type Persona = "Investidor" | "Primeira Casa" | "Empresário" | "Família" | "Autônomo"

export type Regiao = "Sudeste" | "Sul" | "Centro-Oeste" | "Nordeste" | "Norte"

export interface Lead {
  id: string
  nome: string
  telefone: string
  produto: Produto
  marca: Marca
  persona: Persona
  regiao: Regiao
  campanhaId: string | null
  status: LeadStatus
  notas: string | null
  criadoEm: string
  entradaCampanhaEm: string | null
}

export interface CampaignMessage {
  id: string
  dia: number
  horario: string
  texto: string
}

export interface Campaign {
  id: string
  nome: string
  descricao?: string
  status: CampaignStatus
  recorrenciaDias: number
  dataFinal: string | null
  criadoEm: string
  filtros: {
    produto?: Produto | null
    marca?: Marca | null
    persona?: Persona | null
    regiao?: Regiao | null
  }
  mensagens: CampaignMessage[]
}

export interface TimelineEvent {
  id: string
  leadId: string
  campanhaId: string | null
  mensagemId: string | null
  tipo: EventType
  descricao: string
  detalhes?: string
  data: string
  sucesso: boolean
}

export interface Kpis {
  leadsAtivos: number
  campanhasAtivas: number
  mensagensHoje: number
  leadsQualificados: number
  taxaResposta: number
  taxaQualificacao: number
  variacao: {
    leadsAtivos: number
    campanhasAtivas: number
    mensagensHoje: number
    leadsQualificados: number
    taxaResposta: number
    taxaQualificacao: number
  }
}

export const PRODUTOS: Produto[] = [
  "Consórcio Imobiliário",
  "Consórcio de Veículos",
  "Seguro de Vida",
  "Financiamento",
  "Previdência",
]

export const MARCAS: Marca[] = ["Ápice", "NovaVida", "Prisma", "Vértice"]

export const PERSONAS: Persona[] = ["Investidor", "Primeira Casa", "Empresário", "Família", "Autônomo"]

export const REGIOES: Regiao[] = ["Sudeste", "Sul", "Centro-Oeste", "Nordeste", "Norte"]

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  novo: "Novo",
  em_campanha: "Em campanha",
  respondeu: "Respondeu",
  qualificado: "Qualificado",
  encerrado: "Encerrado",
}

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  ativa: "Ativa",
  pausada: "Pausada",
  encerrada: "Encerrada",
  rascunho: "Rascunho",
}

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  mensagem_enviada: "Mensagem enviada",
  falha: "Falha no envio",
  resposta: "Resposta recebida",
  qualificado: "Lead qualificado",
  campanha_iniciada: "Campanha iniciada",
  campanha_encerrada: "Campanha encerrada",
}
