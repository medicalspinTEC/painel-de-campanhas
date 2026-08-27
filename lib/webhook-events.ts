/**
 * Catálogo completo dos eventos que o painel pode notificar por webhook.
 *
 * Serve como fonte única de verdade: a UI monta a seleção a partir daqui e a
 * action valida as chaves recebidas contra esta mesma lista, então adicionar um
 * evento novo é uma alteração em um só lugar.
 */

export type WebhookEventGroup = "Leads" | "Campanhas" | "Mensagens" | "Sistema"

export interface WebhookEventDef {
  /** Chave enviada no payload e persistida no banco. */
  key: string
  label: string
  descricao: string
  grupo: WebhookEventGroup
}

export const WEBHOOK_EVENTS: WebhookEventDef[] = [
  // Leads
  { key: "lead.criado", label: "Lead criado", descricao: "Um novo lead entrou na base.", grupo: "Leads" },
  {
    key: "lead.atualizado",
    label: "Lead atualizado",
    descricao: "Dados de segmentação ou contato foram alterados.",
    grupo: "Leads",
  },
  { key: "lead.removido", label: "Lead removido", descricao: "Um lead foi excluído da base.", grupo: "Leads" },
  {
    key: "lead.status_alterado",
    label: "Status do lead alterado",
    descricao: "O lead mudou de etapa no funil.",
    grupo: "Leads",
  },
  {
    key: "lead.entrou_em_campanha",
    label: "Lead entrou em campanha",
    descricao: "O lead passou a receber uma sequência.",
    grupo: "Leads",
  },

  // Campanhas
  { key: "campanha.criada", label: "Campanha criada", descricao: "Uma campanha foi cadastrada.", grupo: "Campanhas" },
  {
    key: "campanha.atualizada",
    label: "Campanha atualizada",
    descricao: "Filtros, recorrência ou mensagens mudaram.",
    grupo: "Campanhas",
  },
  {
    key: "campanha.iniciada",
    label: "Campanha iniciada",
    descricao: "A campanha passou para o status ativa.",
    grupo: "Campanhas",
  },
  {
    key: "campanha.pausada",
    label: "Campanha pausada",
    descricao: "Os disparos da campanha foram suspensos.",
    grupo: "Campanhas",
  },
  {
    key: "campanha.encerrada",
    label: "Campanha encerrada",
    descricao: "A campanha chegou ao fim ou foi finalizada.",
    grupo: "Campanhas",
  },
  {
    key: "campanha.removida",
    label: "Campanha removida",
    descricao: "Uma campanha foi excluída do painel.",
    grupo: "Campanhas",
  },

  // Mensagens
  {
    key: "mensagem.enviada",
    label: "Mensagem enviada",
    descricao: "Uma mensagem da sequência foi disparada.",
    grupo: "Mensagens",
  },
  {
    key: "mensagem.falha",
    label: "Falha no envio",
    descricao: "O disparo não foi concluído.",
    grupo: "Mensagens",
  },
  {
    key: "mensagem.resposta",
    label: "Resposta recebida",
    descricao: "O lead respondeu a uma mensagem.",
    grupo: "Mensagens",
  },
  {
    key: "mensagem.agendada",
    label: "Mensagem agendada",
    descricao: "Um disparo foi programado para a janela de envio.",
    grupo: "Mensagens",
  },
  {
    key: "mensagem.pulada",
    label: "Mensagem pulada",
    descricao: "Um disparo foi antecipado manualmente na página da campanha.",
    grupo: "Mensagens",
  },

  // Sistema
  {
    key: "configuracoes.atualizadas",
    label: "Configurações atualizadas",
    descricao: "As preferências da engine foram salvas.",
    grupo: "Sistema",
  },
  {
    key: "webhook.teste",
    label: "Teste de webhook",
    descricao: "Disparo manual feito a partir desta página.",
    grupo: "Sistema",
  },
]

export const WEBHOOK_EVENT_GROUPS: WebhookEventGroup[] = ["Leads", "Campanhas", "Mensagens", "Sistema"]

export const WEBHOOK_EVENT_KEYS = WEBHOOK_EVENTS.map((evento) => evento.key)

export const WEBHOOK_EVENT_LABEL: Record<string, string> = Object.fromEntries(
  WEBHOOK_EVENTS.map((evento) => [evento.key, evento.label]),
)

/** Máximo de webhooks que podem coexistir. */
export const WEBHOOK_LIMITE = 5
