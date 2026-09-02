export type LeadStatus = "novo" | "em_campanha" | "respondeu" | "encerrado"

export type CampaignStatus = "ativa" | "pausada" | "encerrada" | "rascunho"

export type EventType =
  | "mensagem_enviada"
  | "falha"
  | "resposta"
  | "removido_campanha"
  | "campanha_iniciada"
  | "campanha_encerrada"

// As dimensões de segmentação (produto, marca, persona, região) são criadas
// pelo usuário na aba de Segmentação e ficam guardadas como texto livre. Por
// isso são apenas `string` — não há mais valores fixos padrão no código.
export type Produto = string

export type Marca = string

export type Persona = string

export type Regiao = string

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
  /** Instância da Evolution que envia as mensagens. Nulo = padrão do ambiente. */
  instanciaNome: string | null
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
  taxaResposta: number
  taxaQualificacao: number
  variacao: {
    leadsAtivos: number
    campanhasAtivas: number
    mensagensHoje: number
    taxaResposta: number
  }
}

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  novo: "Novo",
  em_campanha: "Em campanha",
  respondeu: "Respondeu",
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
  removido_campanha: "Removido da campanha",
  campanha_iniciada: "Campanha iniciada",
  campanha_encerrada: "Campanha encerrada",
}
