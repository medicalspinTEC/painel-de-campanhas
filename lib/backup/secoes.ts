/**
 * Catálogo do que pode entrar no backup. Sem imports de servidor: é usado pela
 * tela (para listar as opções) e pelo serviço (para saber o que ler).
 *
 * Cada seção agrupa tabelas que fazem sentido juntas. `tabelas` usa o nome do
 * model do Prisma e precisa ter um leitor correspondente em `services/backup.ts`.
 */

export interface SecaoBackup {
  chave: string
  nome: string
  descricao: string
  tabelas: string[]
  /** Costuma ser grande: a tela avisa que o envio demora mais. */
  pesada?: boolean
}

export const SECOES_BACKUP: SecaoBackup[] = [
  {
    chave: "leads",
    nome: "Leads",
    descricao: "Cadastro dos leads e as anotações internas do chat.",
    tabelas: ["Lead", "ChatInternalNote"],
  },
  {
    chave: "campanhas",
    nome: "Campanhas",
    descricao: "Campanhas, sequência de mensagens e vínculos entre leads e campanhas.",
    tabelas: ["Campaign", "CampaignMessage", "LeadCampaign"],
  },
  {
    chave: "segmentacao",
    nome: "Segmentação",
    descricao: "Catálogos de produtos, marcas, personas e regiões.",
    tabelas: ["Produto", "Marca", "Persona", "Regiao"],
  },
  {
    chave: "agendadas",
    nome: "Mensagens agendadas",
    descricao: "Mensagens avulsas agendadas e o resultado do envio.",
    tabelas: ["ScheduledMessage"],
  },
  {
    chave: "historico",
    nome: "Histórico dos leads",
    descricao: "Linha do tempo: mensagens enviadas, respostas e falhas de cada lead.",
    tabelas: ["TimelineEvent"],
    pesada: true,
  },
  {
    chave: "crm",
    nome: "CRM",
    descricao: "Departamentos, atendentes, conversas atribuídas, histórico de transferências e estado dos bots nas conversas, os bots de follow-up (templates e ajustes por conversa) e os agentes de IA (sem a chave de API).",
    tabelas: ["Departamento", "Atendente", "AtendenteDepartamento", "LeadAtendimento", "AtendimentoTransferencia", "BotConversa", "FollowUpBot", "FollowUpTemplate", "FollowUpConversa", "AgenteIA"],
  },
  {
    chave: "nocode",
    nome: "Fluxos No Code",
    descricao: "Os fluxos (blocos e conexões). O segredo de assinatura do webhook de execuções não é enviado.",
    tabelas: ["NoCodeFlow"],
  },
  {
    chave: "nocode_execucoes",
    nome: "Execuções dos fluxos",
    descricao: "Histórico de execuções dos fluxos No Code, com entrada e passos.",
    tabelas: ["NoCodeExecution"],
    pesada: true,
  },
  {
    chave: "usuarios",
    nome: "Usuários",
    descricao: "Usuários do painel, níveis e permissões. As senhas (hash) nunca são enviadas.",
    tabelas: ["User"],
  },
  {
    chave: "integracoes",
    nome: "Integrações",
    descricao: "Webhooks de saída (sem o segredo) e instâncias de WhatsApp cadastradas.",
    tabelas: ["Webhook", "Instance"],
  },
  {
    chave: "configuracoes",
    nome: "Configurações",
    descricao: "Preferências da engine, janela de envio, plugins ativos e aparência.",
    tabelas: ["Settings"],
  },
  {
    chave: "eventos_entrada",
    nome: "Eventos recebidos",
    descricao: "Eventos recebidos pelo webhook de entrada.",
    tabelas: ["InboundEvent"],
    pesada: true,
  },
  {
    chave: "logs",
    nome: "Logs do sistema",
    descricao: "Erros e avisos registrados pelo app.",
    tabelas: ["AppLog"],
    pesada: true,
  },
]

export const SECOES_POR_CHAVE: Record<string, SecaoBackup> = Object.fromEntries(
  SECOES_BACKUP.map((secao) => [secao.chave, secao]),
)

/** Seleção inicial sugerida: tudo o que é cadastro; os históricos grandes ficam de fora. */
export const SECOES_PADRAO: string[] = SECOES_BACKUP.filter((s) => !s.pesada).map((s) => s.chave)

/**
 * Colunas que NUNCA entram no backup nem voltam na restauração, por model.
 * `services/backup.ts` as remove ao gerar o arquivo e `lib/backup/modelos.ts`
 * as exclui da leitura e da atualização ao restaurar (vale mesmo para um
 * arquivo adulterado).
 */
export const COLUNAS_SECRETAS: Readonly<Record<string, readonly string[]>> = {
  User: ["senhaHash"],
  Webhook: ["secret"],
  NoCodeFlow: ["execWebhookSegredo"],
  AgenteIA: ["apiKey"],
}

/** Mantém só chaves conhecidas, sem repetição e na ordem do catálogo. */
export function normalizarSecoes(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  const escolhidas = new Set(valor.filter((v): v is string => typeof v === "string"))
  return SECOES_BACKUP.filter((s) => escolhidas.has(s.chave)).map((s) => s.chave)
}
