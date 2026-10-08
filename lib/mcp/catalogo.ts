/**
 * Catálogo das funções (tools) do MCP.
 *
 * Arquivo puro (sem servidor/cliente): é a FONTE ÚNICA usada por
 *  - `components/features/integrations/mcp-manager.tsx`: o usuário escolhe, antes de gerar o token,
 *    quais funções o MCP pode executar;
 *  - `lib/mcp/server.ts`: só registra as funções liberadas no token e bloqueia, na hora da
 *    chamada, as que dependem de um plugin desativado;
 *  - `services/mcp-token.ts`: valida/normaliza a lista guardada no token.
 *
 * Para criar uma função nova: adicione a entrada aqui (informando os `plugins` de que ela depende)
 * e registre a implementação em `lib/mcp/server.ts` com o mesmo `nome`.
 */
import { PLUGIN_NOME, type PluginKey, type PluginsAtivos } from "@/lib/plugins"

export type McpTipoFuncao = "leitura" | "criacao" | "edicao" | "exclusao" | "acao"

export const MCP_TIPO_LABEL: Record<McpTipoFuncao, string> = {
  leitura: "Consulta",
  criacao: "Criação",
  edicao: "Edição",
  exclusao: "Exclusão",
  acao: "Ação",
}

export type McpFerramentaDef = {
  /** Nome técnico da tool (é o que a IA enxerga). */
  nome: string
  /** Rótulo para a tela e para as mensagens ao usuário. */
  titulo: string
  grupo: string
  tipo: McpTipoFuncao
  /** Plugins que precisam estar ATIVOS para a função executar. Vazio = sempre disponível. */
  plugins: readonly PluginKey[]
}

function f(nome: string, titulo: string, grupo: string, tipo: McpTipoFuncao, plugins: readonly PluginKey[] = []): McpFerramentaDef {
  return { nome, titulo, grupo, tipo, plugins }
}

export const MCP_GRUPOS = [
  "Leads",
  "Campanhas",
  "Produtos e segmentação",
  "Indicadores e eventos",
  "Kanban",
  "Chat",
  "CRM",
  "No Code",
  "Agentes de IA",
] as const

export const MCP_FERRAMENTAS: readonly McpFerramentaDef[] = [
  // Leads
  f("listar_leads", "Listar leads", "Leads", "leitura"),
  f("buscar_negocio_bdr", "Buscar negócio no BDR", "Leads", "leitura"),
  f("obter_lead", "Obter lead", "Leads", "leitura"),
  f("criar_lead", "Criar lead", "Leads", "criacao"),
  f("editar_lead", "Editar lead", "Leads", "edicao"),
  f("atualizar_status_lead", "Atualizar status do lead", "Leads", "edicao"),
  f("anotar_lead", "Anotar lead", "Leads", "edicao"),
  f("vincular_lead_campanha", "Vincular lead a uma campanha", "Leads", "edicao"),
  f("remover_lead_da_campanha", "Remover lead da campanha", "Leads", "edicao"),
  f("enviar_mensagem_lead", "Enviar mensagem avulsa a um lead", "Leads", "acao"),
  f("excluir_lead", "Excluir lead", "Leads", "exclusao"),

  // Campanhas
  f("listar_campanhas", "Listar campanhas", "Campanhas", "leitura"),
  f("obter_campanha", "Obter campanha", "Campanhas", "leitura"),
  f("criar_campanha", "Criar campanha", "Campanhas", "criacao"),
  f("editar_campanha", "Editar campanha", "Campanhas", "edicao"),
  f("definir_status_campanha", "Definir status da campanha", "Campanhas", "edicao"),
  f("duplicar_campanha", "Duplicar campanha", "Campanhas", "criacao"),
  f("excluir_campanha", "Excluir campanha", "Campanhas", "exclusao"),

  // Produtos e segmentação
  f("listar_produtos", "Listar produtos", "Produtos e segmentação", "leitura"),
  f("criar_produto", "Criar produto", "Produtos e segmentação", "criacao"),
  f("editar_produto", "Editar produto", "Produtos e segmentação", "edicao"),
  f("excluir_produto", "Excluir produto", "Produtos e segmentação", "exclusao"),
  f("listar_segmentacao", "Listar marcas, personas ou regiões", "Produtos e segmentação", "leitura"),
  f("criar_item_segmentacao", "Criar marca, persona ou região", "Produtos e segmentação", "criacao"),
  f("editar_item_segmentacao", "Editar marca, persona ou região", "Produtos e segmentação", "edicao"),
  f("excluir_item_segmentacao", "Excluir marca, persona ou região", "Produtos e segmentação", "exclusao"),

  // Indicadores e eventos
  f("obter_indicadores", "Obter indicadores do painel", "Indicadores e eventos", "leitura"),
  f("listar_respostas_lead", "Listar respostas recebidas", "Indicadores e eventos", "leitura"),
  f("obter_envio", "Obter envio", "Indicadores e eventos", "leitura"),
  f("listar_eventos_recentes", "Listar eventos recentes", "Indicadores e eventos", "leitura"),

  // Kanban
  f("obter_quadro_kanban", "Ver o quadro Kanban", "Kanban", "leitura", ["kanban"]),
  f("mover_lead_kanban", "Mover lead no Kanban", "Kanban", "edicao", ["kanban"]),

  // Chat
  f("listar_conversas_chat", "Listar conversas do chat", "Chat", "leitura", ["chat"]),
  f("obter_mensagens_chat", "Ler mensagens de uma conversa", "Chat", "leitura", ["chat"]),
  f("adicionar_nota_chat", "Adicionar nota interna na conversa", "Chat", "criacao", ["chat"]),

  // CRM
  f("listar_departamentos", "Listar departamentos e bots de entrada", "CRM", "leitura", ["crm"]),
  f("criar_departamento", "Criar departamento", "CRM", "criacao", ["crm"]),
  f("editar_departamento", "Editar departamento", "CRM", "edicao", ["crm"]),
  f("excluir_departamento", "Excluir departamento", "CRM", "exclusao", ["crm"]),
  f("listar_atendentes", "Listar atendentes", "CRM", "leitura", ["crm"]),
  f("definir_atendente_ativo", "Ativar ou inativar atendente", "CRM", "edicao", ["crm"]),
  f("transferir_conversa", "Transferir conversa", "CRM", "acao", ["chat", "crm"]),
  f("enviar_lead_para_campanha_chat", "Enviar lead da conversa para uma campanha", "CRM", "acao", ["chat", "crm"]),
  f("criar_bot", "Criar bot", "CRM", "criacao", ["crm", "nocode"]),
  f("definir_bot_ativo", "Ativar ou desativar bot", "CRM", "edicao", ["crm", "nocode"]),
  f("excluir_bot", "Excluir bot", "CRM", "exclusao", ["crm", "nocode"]),

  // No Code
  f("listar_fluxos_nocode", "Listar fluxos do No Code", "No Code", "leitura", ["nocode"]),
  f("obter_fluxo_nocode", "Obter fluxo do No Code (blocos e ligações)", "No Code", "leitura", ["nocode"]),
  f("listar_execucoes_fluxo", "Listar execuções de um fluxo", "No Code", "leitura", ["nocode"]),
  f("criar_fluxo_nocode", "Criar fluxo do No Code", "No Code", "criacao", ["nocode"]),
  f("editar_fluxo_nocode", "Editar fluxo do No Code", "No Code", "edicao", ["nocode"]),
  f("definir_fluxo_nocode_ativo", "Ativar ou desativar fluxo", "No Code", "edicao", ["nocode"]),
  f("excluir_fluxo_nocode", "Excluir fluxo do No Code", "No Code", "exclusao", ["nocode"]),

  // Agentes de IA
  f("listar_agentes_ia", "Listar agentes de IA", "Agentes de IA", "leitura", ["agentesIa"]),
  f("criar_agente_ia", "Criar agente de IA", "Agentes de IA", "criacao", ["agentesIa"]),
  f("editar_agente_ia", "Editar agente de IA", "Agentes de IA", "edicao", ["agentesIa"]),
  f("definir_agente_ia_ativo", "Ativar ou desativar agente de IA", "Agentes de IA", "edicao", ["agentesIa"]),
  f("excluir_agente_ia", "Excluir agente de IA", "Agentes de IA", "exclusao", ["agentesIa"]),
  f("vincular_agente_departamento", "Vincular agente a um departamento", "Agentes de IA", "edicao", ["agentesIa", "crm"]),
  f("definir_agente_entrada", "Definir o agente de entrada", "Agentes de IA", "edicao", ["agentesIa", "crm"]),
]

export const MCP_FERRAMENTA_POR_NOME: ReadonlyMap<string, McpFerramentaDef> = new Map(
  MCP_FERRAMENTAS.map((ferramenta) => [ferramenta.nome, ferramenta]),
)

/**
 * Funções que o MCP já tinha antes da seleção por token. Tokens criados naquela época continuam
 * com exatamente estas (a migration grava a mesma lista) — nada novo é liberado sem o usuário escolher.
 */
export const MCP_FERRAMENTAS_LEGADO: readonly string[] = [
  "listar_leads",
  "buscar_negocio_bdr",
  "obter_lead",
  "criar_lead",
  "atualizar_status_lead",
  "anotar_lead",
  "enviar_mensagem_lead",
  "listar_campanhas",
  "obter_campanha",
  "criar_campanha",
  "definir_status_campanha",
  "listar_produtos",
  "obter_indicadores",
  "listar_respostas_lead",
  "obter_envio",
  "listar_eventos_recentes",
]

/** Mantém só nomes conhecidos, sem repetição. */
export function normalizarFerramentas(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  return [...new Set(valor.filter((v): v is string => typeof v === "string" && MCP_FERRAMENTA_POR_NOME.has(v)))]
}

// ---------------------------------------------------------------------------
// Regras de plugin
// ---------------------------------------------------------------------------

/** Plugins exigidos pela função que estão desativados. Vazio = pode executar. */
export function pluginsFaltando(ferramenta: McpFerramentaDef, ativos: Partial<PluginsAtivos>): PluginKey[] {
  return ferramenta.plugins.filter((plugin) => ativos[plugin] !== true)
}

export function listaDePlugins(plugins: readonly PluginKey[]): string {
  const nomes = plugins.map((plugin) => PLUGIN_NOME[plugin])
  if (nomes.length <= 1) return nomes[0] ?? ""
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`
}

/**
 * Texto devolvido à IA (e, por ela, ao usuário) quando a função NÃO foi executada por falta de plugin.
 * Fica explícito que nada foi alterado e onde ativar.
 */
export function mensagemPluginNecessario(ferramenta: McpFerramentaDef, faltando: readonly PluginKey[]): string {
  const exigidos = listaDePlugins(ferramenta.plugins)
  const desativados = listaDePlugins(faltando)
  const plural = faltando.length > 1
  return (
    `A função “${ferramenta.titulo}” NÃO foi executada: ela só funciona com ${ferramenta.plugins.length > 1 ? `os plugins ${exigidos} ativos` : `o plugin ${exigidos} ativo`}, ` +
    `e ${plural ? "os plugins" : "o plugin"} ${desativados} ${plural ? "estão desativados" : "está desativado"} nesta instância. ` +
    `Nada foi alterado. Avise o usuário para ativar em Integrações → Plugins e peça a ação de novo depois.`
  )
}
