import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { PROVEDORES } from "@/lib/agentes-ia"
import {
  listaDePlugins,
  MCP_FERRAMENTA_POR_NOME,
  mensagemPluginNecessario,
  pluginsFaltando,
  type McpFerramentaDef,
} from "@/lib/mcp/catalogo"
import { PROMPT_TREINAMENTO_MCP } from "@/lib/mcp/prompt-treinamento"
import { modeloFluxoResposta, validarGrafo, type FlowEdge, type FlowNode } from "@/lib/nocode/catalog"
import { PLUGIN_NOME, PluginDesativadoError, type PluginsAtivos } from "@/lib/plugins"
import { prisma } from "@/lib/prisma"
import { validarTelefoneBR } from "@/lib/telefone"
import {
  AgenteIaError,
  ativarAgente,
  atualizarAgente,
  criarAgente,
  definirAgenteDeEntrada,
  excluirAgente,
  listarAgentes,
  vincularAgenteAoDepartamento,
} from "@/services/agentes-ia"
import { getKpis } from "@/services/analytics"
import { recordAppLog } from "@/services/app-logs"
import { ativarBotDoCrm, criarBotDoCrm, excluirBotDoCrm } from "@/services/bots"
import {
  createCampaign,
  deleteCampaign,
  duplicateCampaign,
  getCampaign,
  getIndividualLeadMessages,
  listCampaigns,
  setCampaignStatus,
  updateCampaign,
  type CampaignInput,
} from "@/services/campaigns"
import {
  ItemCatalogoDuplicadoError,
  ItemCatalogoIdImportacaoDuplicadoError,
  servicoMarcas,
  servicoPersonas,
  servicoRegioes,
} from "@/services/catalogo-segmentacao"
import { addChatInternalNote, getChatInbox, getChatMessages } from "@/services/chat"
import {
  createDepartamento,
  CrmError,
  deleteDepartamento,
  getCrmData,
  setAtendenteAtivo,
  transferirConversa,
  updateDepartamento,
} from "@/services/crm"
import { getEvent, listEvents, listLeadResponses } from "@/services/events"
import { getKanbanBoard, moverLeadKanban } from "@/services/kanban"
import { enviarLeadParaCampanha } from "@/services/lead-campanha"
import {
  assignCampaign,
  countLeads,
  createLead,
  deleteLead,
  getLead,
  getLeadTimeline,
  LeadNaoContatarError,
  LeadValidationError,
  listLeads,
  sendLeadMessage,
  setLeadStatus,
  updateLead,
  updateLeadNotes,
  type LeadInput,
} from "@/services/leads"
import {
  contarExecucoes,
  createFlow,
  deleteFlow,
  getFlow,
  listExecutions,
  listFlows,
  MSG_FLUXO_SISTEMA_DESATIVAR,
  MSG_FLUXO_SISTEMA_EXCLUIR,
  updateFlow,
} from "@/services/nocode"
import {
  createProduto,
  deleteProduto,
  listProdutos,
  ProdutoDuplicadoError,
  ProdutoIdImportacaoDuplicadoError,
  updateProduto,
} from "@/services/produtos"
import { getPluginsAtivos } from "@/services/settings"
import { emitWebhookEvent } from "@/services/webhooks"
import type { CampaignStatus, LeadStatus } from "@/types"

/**
 * Servidor MCP (Model Context Protocol) do painel.
 *
 * Expõe, como "tools" que um cliente MCP (Claude, por exemplo) pode chamar, as mesmas operações do
 * painel — a lógica de negócio é 100% reaproveitada de `services/*`.
 *
 * Três regras valem para TODA função (ver `registrar`):
 *  1. Só são registradas as funções que o dono do token liberou em Integrações (`ferramentas`).
 *     A IA nem enxerga as demais — não há nada para configurar do lado dela.
 *  2. Função que depende de plugin (`lib/mcp/catalogo.ts`) NÃO executa com o plugin desativado: devolve
 *     `codigo: "PLUGIN_DESATIVADO"` com uma mensagem clara para repassar ao usuário. A checagem roda a
 *     cada chamada, então vale mesmo que o plugin seja desligado com a IA já conectada.
 *  3. Toda execução é auditada (log + webhook `mcp.acao_executada`), com a chave de API oculta.
 *
 * A conexão em si (autenticação, transporte HTTP) fica em `app/api/mcp/route.ts`. Uma instância nova
 * é criada a cada requisição (modo stateless): este módulo não guarda estado entre chamadas.
 * O texto que treina a IA vem de `lib/mcp/prompt-treinamento.ts`.
 */

const STATUS_LEAD_VALORES: [LeadStatus, ...LeadStatus[]] = ["novo", "em_campanha", "sem_campanha", "respondeu", "encerrado", "nao_contatar"]

const STATUS_CAMPANHA_VALORES: [CampaignStatus, ...CampaignStatus[]] = ["rascunho", "ativa", "pausada", "encerrada"]

const PROVEDORES_VALORES = PROVEDORES.map((p) => p.key) as [string, ...string[]]

/** Quem aparece como autor nas notas e no histórico das ações feitas pelo MCP. */
const AUTOR_MCP = "Assistente (MCP)"
const EXECUTOR_MCP = { id: "mcp", nome: AUTOR_MCP, role: "admin" as const }

const SERVICOS_SEGMENTACAO = { marca: servicoMarcas, persona: servicoPersonas, regiao: servicoRegioes } as const
const TIPO_SEGMENTACAO = z.enum(["marca", "persona", "regiao"]).describe("Qual catálogo: marca, persona ou regiao.")

const CONFIRMAR_EXCLUSAO = z
  .literal(true)
  .describe("Envie true SOMENTE depois de o usuário confirmar explicitamente a exclusão. A exclusão é permanente.")

/** Empacota qualquer valor em um resultado de tool MCP (texto com JSON). */
function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }
}

/** Mesmo formato acima, mas sinalizando erro para o cliente MCP. */
function errorResult(mensagem: string, extra?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ ok: false, erro: mensagem, ...extra }, null, 2) }],
    isError: true as const,
  }
}

/** Resposta padrão quando a função não roda por falta de plugin. */
function bloqueioPorPlugin(ferramenta: McpFerramentaDef, faltando: PluginsAtivosChaves) {
  return errorResult(mensagemPluginNecessario(ferramenta, faltando), {
    naoExecutado: true,
    codigo: "PLUGIN_DESATIVADO",
    funcao: ferramenta.nome,
    pluginsNecessarios: ferramenta.plugins.map((plugin) => PLUGIN_NOME[plugin]),
    pluginsDesativados: faltando.map((plugin) => PLUGIN_NOME[plugin]),
  })
}

type PluginsAtivosChaves = (keyof PluginsAtivos)[]

/** Erros de regra de negócio: viram uma resposta de erro legível em vez de falha do servidor. */
function ehErroDeRegra(error: unknown): error is Error {
  return (
    error instanceof CrmError ||
    error instanceof AgenteIaError ||
    error instanceof ProdutoDuplicadoError ||
    error instanceof ProdutoIdImportacaoDuplicadoError ||
    error instanceof ItemCatalogoDuplicadoError ||
    error instanceof ItemCatalogoIdImportacaoDuplicadoError
  )
}

async function registrarAuditoriaMcp(ferramenta: string, argumentos: unknown, sucesso: boolean, erro?: string): Promise<void> {
  const executadoEm = new Date().toISOString()
  let argumentosJson = "{}"
  try {
    // Chaves de API nunca vão para log nem para webhook.
    argumentosJson = JSON.stringify(argumentos, (chave, valor) => (chave === "apiKey" ? "[oculto]" : valor)) ?? "{}"
  } catch {
    argumentosJson = "[argumentos não serializáveis]"
  }
  const argumentosLimitados = argumentosJson.length > 4000 ? `${argumentosJson.slice(0, 4000)} [truncado]` : argumentosJson
  const dados = {
    ferramenta,
    argumentos: argumentosLimitados,
    sucesso,
    ...(erro ? { erro: erro.slice(0, 1000) } : {}),
    executadoEm,
  }

  try {
    await Promise.all([
      recordAppLog({
        nivel: sucesso ? "info" : "aviso",
        origem: "mcp",
        mensagem: `Ferramenta MCP ${ferramenta} executada${sucesso ? "" : " com falha"}.`,
        detalhes: dados,
      }),
      emitWebhookEvent("mcp.acao_executada", dados),
    ])
  } catch (error) {
    console.error("[mcp] Falha ao registrar auditoria da ferramenta:", error)
  }
}

type Contexto = {
  server: McpServer
  permitidas: ReadonlySet<string>
  plugins: PluginsAtivos
}

/**
 * Registra uma função — só se o token a liberou — já com a checagem de plugin e a auditoria.
 * `nome` precisa existir em `lib/mcp/catalogo.ts` (é de lá que vêm título, tipo e plugins exigidos).
 */
function registrar<const Args extends z.ZodRawShape>(
  ctx: Contexto,
  nome: string,
  descricao: string,
  inputSchema: Args,
  callback: ToolCallback<Args>,
): void {
  const def = MCP_FERRAMENTA_POR_NOME.get(nome)
  if (!def) throw new Error(`[mcp] Função "${nome}" não está em lib/mcp/catalogo.ts.`)
  if (!ctx.permitidas.has(nome)) return

  const faltandoAgora = pluginsFaltando(def, ctx.plugins)
  const prefixo = faltandoAgora.length
    ? `[INDISPONÍVEL AGORA — exige o plugin ${listaDePlugins(def.plugins)} ativo; desativado: ${listaDePlugins(faltandoAgora)}. Não execute: avise o usuário.] `
    : ""
  const sufixo = def.plugins.length ? ` Exige o(s) plugin(s): ${listaDePlugins(def.plugins)}.` : ""

  // `ToolCallback` é um tipo condicional: tratamos como função genérica para poder chamá-la daqui.
  const chamar = callback as unknown as (args: unknown, extra: unknown) => Promise<{ isError?: boolean }>

  const executar = async (args: unknown, extra: unknown) => {
    // Estado atual dos plugins: vale para esta chamada, mesmo que tenha mudado depois da conexão.
    const faltando = pluginsFaltando(def, await getPluginsAtivos())
    if (faltando.length > 0) {
      await registrarAuditoriaMcp(nome, args, false, "Plugin desativado: função não executada.")
      return bloqueioPorPlugin(def, faltando)
    }

    try {
      const resultado = await chamar(args, extra)
      await registrarAuditoriaMcp(nome, args, !resultado.isError, resultado.isError ? "A ferramenta retornou erro." : undefined)
      return resultado
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : String(error)
      await registrarAuditoriaMcp(nome, args, false, mensagem)

      if (error instanceof PluginDesativadoError) {
        const ampliada: McpFerramentaDef = { ...def, plugins: [...new Set([...def.plugins, error.plugin])] }
        return bloqueioPorPlugin(ampliada, [error.plugin])
      }
      if (ehErroDeRegra(error)) return errorResult(error.message)
      throw error
    }
  }

  ctx.server.registerTool<Args, Args>(
    nome,
    {
      title: def.titulo,
      description: `${prefixo}${descricao}${sufixo}`,
      inputSchema,
      annotations: { readOnlyHint: def.tipo === "leitura", destructiveHint: def.tipo === "exclusao" },
    },
    executar as unknown as ToolCallback<Args>,
  )
}

function montarInstrucoes(permitidas: ReadonlySet<string>, plugins: PluginsAtivos): string {
  const ativos = (Object.keys(PLUGIN_NOME) as (keyof PluginsAtivos)[]).filter((p) => plugins[p]).map((p) => PLUGIN_NOME[p])
  const inativos = (Object.keys(PLUGIN_NOME) as (keyof PluginsAtivos)[]).filter((p) => !plugins[p]).map((p) => PLUGIN_NOME[p])
  const funcoes = [...permitidas].filter((nome) => MCP_FERRAMENTA_POR_NOME.has(nome))
  return [
    PROMPT_TREINAMENTO_MCP.trim(),
    "",
    "# ESTADO DESTA CONEXÃO (gerado pelo painel)",
    `- Plugins ativos agora: ${ativos.length ? ativos.join(", ") : "nenhum"}.`,
    `- Plugins desativados agora: ${inativos.length ? inativos.join(", ") : "nenhum"}.`,
    `- Funções liberadas neste token: ${funcoes.join(", ") || "nenhuma"}.`,
    "- O estado dos plugins pode mudar durante a conversa; a checagem é refeita a cada execução.",
  ].join("\n")
}

function textoOuNull(valor: string | null | undefined): string | null {
  const limpo = valor?.trim()
  return limpo ? limpo : null
}

export async function createAppMcpServer(opcoes: { ferramentas: readonly string[] }): Promise<McpServer> {
  const permitidas = new Set(opcoes.ferramentas)
  const plugins = await getPluginsAtivos()

  const server = new McpServer(
    {
      name: "engine-followup",
      version: "2.0.0",
      title: "Painel de Campanhas (Engine Follow-up)",
    },
    { instructions: montarInstrucoes(permitidas, plugins) },
  )
  const ctx: Contexto = { server, permitidas, plugins }

  server.registerPrompt(
    "treinamento_painel",
    {
      title: "Como operar o painel",
      description: "Regras e boas práticas para usar as ferramentas deste painel.",
    },
    async () => ({
      messages: [{ role: "user" as const, content: { type: "text" as const, text: montarInstrucoes(permitidas, plugins) } }],
    }),
  )

  // Sempre disponível (não depende de seleção): deixa a IA explicar ao usuário o que pode e o que não pode.
  server.registerTool(
    "consultar_status_mcp",
    {
      title: "Consultar status do MCP",
      description:
        "Mostra quais plugins estão ativos e quais funções este token pode executar, indicando as que estão indisponíveis agora por falta de plugin.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const ativos = await getPluginsAtivos()
      const funcoes = [...permitidas]
        .map((nome) => MCP_FERRAMENTA_POR_NOME.get(nome))
        .filter((def): def is McpFerramentaDef => Boolean(def))
        .map((def) => {
          const faltando = pluginsFaltando(def, ativos)
          return {
            nome: def.nome,
            titulo: def.titulo,
            tipo: def.tipo,
            grupo: def.grupo,
            pluginsNecessarios: def.plugins.map((p) => PLUGIN_NOME[p]),
            disponivelAgora: faltando.length === 0,
            pluginsDesativados: faltando.map((p) => PLUGIN_NOME[p]),
          }
        })
      return jsonResult({
        ok: true,
        plugins: (Object.keys(PLUGIN_NOME) as (keyof PluginsAtivos)[]).map((p) => ({ plugin: PLUGIN_NOME[p], ativo: ativos[p] })),
        funcoesLiberadas: funcoes,
      })
    },
  )

  // ---------------------------------------------------------------------
  // Leads
  // ---------------------------------------------------------------------

  registrar(
    ctx,
    "listar_leads",
    "Lista até 50 leads por página com agregações de mensagens e respostas. Informe pagina (padrão: 1); o resultado indica quando existe próxima página. Aceita filtros por campanha, status e termo de busca por nome ou telefone.",
    {
      campanhaId: z.string().optional().describe("Filtra leads associados à campanha, incluindo histórico de eventos."),
      status: z.enum(STATUS_LEAD_VALORES).optional().describe("Filtra pelo status do lead."),
      busca: z.string().optional().describe("Filtra por nome ou telefone contendo este texto."),
      pagina: z.number().int().min(1).optional().describe("Página de resultados; padrão: 1."),
    },
    async ({ campanhaId, status, busca, pagina }) => {
      const paginaAtual = pagina ?? 1
      const limite = 50
      const filtros = { campanhaId, status, busca }
      const [leadsConsultados, total] = await Promise.all([
        listLeads({ ...filtros, pagina: paginaAtual, limite: limite + 1 }),
        countLeads(filtros),
      ])
      const temProximaPagina = leadsConsultados.length > limite
      const leads = leadsConsultados.slice(0, limite)
      return jsonResult({
        ok: true,
        pagina: paginaAtual,
        limite,
        total,
        quantidade: leads.length,
        temProximaPagina,
        proximaPagina: temProximaPagina ? paginaAtual + 1 : null,
        leads,
      })
    },
  )

  registrar(
    ctx,
    "buscar_negocio_bdr",
    "Localiza no cadastro do painel os leads cujo campo negocio corresponde exatamente ao identificador informado e retorna cada perfil completo com sua timeline. Não consulta um BDR externo; usa o vínculo local registrado no lead.",
    { negocio: z.string().min(1).describe("ID do negócio registrado no campo negocio do lead.") },
    async ({ negocio }) => {
      const negocioId = negocio.trim()
      if (!negocioId) return errorResult("Informe o ID do negócio.")
      const leads = await listLeads({ negocio: negocioId })
      const relacionados = await Promise.all(leads.map(async (lead) => ({ lead, timeline: await getLeadTimeline(lead.id) })))
      return jsonResult({ ok: true, negocio: negocioId, total: relacionados.length, relacionados })
    },
  )

  registrar(
    ctx,
    "obter_lead",
    "Busca um lead específico pelo ID, incluindo sua linha do tempo de eventos.",
    { id: z.string().describe("ID do lead.") },
    async ({ id }) => {
      const lead = await getLead(id)
      if (!lead) return errorResult("Lead não encontrado.")
      const timeline = await getLeadTimeline(id)
      return jsonResult({ ok: true, lead, timeline })
    },
  )

  registrar(
    ctx,
    "criar_lead",
    "Cadastra um novo lead. Apenas nome e telefone (com DDI 55) são obrigatórios; as demais dimensões de segmentação são texto livre e opcionais.",
    {
      nome: z.string().min(3).describe("Nome completo do lead."),
      telefone: z.string().describe("Telefone com código do país, ex.: 5551999999999."),
      produto: z.string().optional(),
      marca: z.string().optional(),
      persona: z.string().optional(),
      regiao: z.string().optional(),
      notas: z.string().optional(),
      negocio: z.string().optional().describe("ID do negócio em um CRM externo, texto livre."),
      status: z.enum(STATUS_LEAD_VALORES).optional().describe("Padrão: novo."),
      campanhaId: z.string().optional().describe("ID de uma campanha para vincular o lead já na criação."),
    },
    async ({ nome, telefone, produto, marca, persona, regiao, notas, negocio, status, campanhaId }) => {
      const telefoneValidado = validarTelefoneBR(telefone)
      if (!telefoneValidado.ok) return errorResult(telefoneValidado.erro ?? "Telefone inválido.")
      const input: LeadInput = {
        nome,
        telefone,
        produto,
        marca,
        persona,
        regiao,
        notas: notas ?? null,
        negocio: negocio ?? null,
        status: status ?? "novo",
        campanhaId: campanhaId ?? null,
        campanhasIds: campanhaId ? [campanhaId] : [],
      }
      try {
        const lead = await createLead(input)
        return jsonResult({ ok: true, lead: (await getLead(lead.id)) ?? lead })
      } catch (error) {
        if (error instanceof LeadValidationError) return errorResult("Corrija os campos destacados.", { errors: error.errors })
        throw error
      }
    },
  )

  registrar(
    ctx,
    "editar_lead",
    "Edita os dados cadastrais de um lead (nome, telefone, segmentação, notas, negócio, atividade). Envie SÓ os campos a alterar; os demais permanecem. Para campos de texto opcionais, envie string vazia para limpar. Não muda status nem campanha (use atualizar_status_lead e vincular_lead_campanha).",
    {
      id: z.string().describe("ID do lead."),
      nome: z.string().min(3).optional(),
      telefone: z.string().optional().describe("Com código do país, ex.: 5551999999999."),
      produto: z.string().optional(),
      marca: z.string().optional(),
      persona: z.string().optional(),
      regiao: z.string().optional(),
      notas: z.string().optional().describe("Substitui as notas; vazio limpa."),
      negocio: z.string().optional().describe("ID do negócio em CRM externo; vazio limpa."),
      atividade: z.string().optional().describe("ID da atividade; vazio limpa."),
    },
    async ({ id, nome, telefone, produto, marca, persona, regiao, notas, negocio, atividade }) => {
      const atual = await getLead(id)
      if (!atual) return errorResult("Lead não encontrado.")
      if (telefone !== undefined) {
        const validado = validarTelefoneBR(telefone)
        if (!validado.ok) return errorResult(validado.erro ?? "Telefone inválido.")
      }
      const input: LeadInput = {
        nome: nome ?? atual.nome,
        telefone: telefone ?? atual.telefone,
        status: atual.status,
        produto,
        marca,
        persona,
        regiao,
        notas,
        negocio,
        atividade,
        // Campanhas e status ficam exatamente como estão.
        campanhaId: atual.campanhaId,
        campanhasIds: atual.campanhasIds,
      }
      try {
        const lead = await updateLead(id, input)
        if (!lead) return errorResult("Lead não encontrado.")
        return jsonResult({ ok: true, lead: (await getLead(id)) ?? lead })
      } catch (error) {
        if (error instanceof LeadValidationError) return errorResult("Corrija os campos destacados.", { errors: error.errors })
        throw error
      }
    },
  )

  registrar(
    ctx,
    "atualizar_status_lead",
    "Altera o status de um lead. Ao marcar como 'respondeu', o lead sai automaticamente de todas as campanhas em que estava.",
    {
      id: z.string().describe("ID do lead."),
      status: z.enum(STATUS_LEAD_VALORES),
      resposta: z.string().optional().describe("Texto opcional do que o lead respondeu."),
    },
    async ({ id, status, resposta }) => {
      const lead = await setLeadStatus(id, status, resposta ?? null)
      if (!lead) return errorResult("Lead não encontrado.")
      return jsonResult({ ok: true, lead: (await getLead(lead.id)) ?? lead })
    },
  )

  registrar(
    ctx,
    "anotar_lead",
    "Substitui as anotações internas de um lead pelo texto informado.",
    { id: z.string(), notas: z.string() },
    async ({ id, notas }) => {
      const lead = await updateLeadNotes(id, notas)
      if (!lead) return errorResult("Lead não encontrado.")
      return jsonResult({ ok: true, lead: (await getLead(lead.id)) ?? lead })
    },
  )

  registrar(
    ctx,
    "vincular_lead_campanha",
    "Vincula um lead a uma campanha (o lead passa a 'em_campanha'). Em campanhas do tipo individual, informe a mensagem do lead.",
    {
      leadId: z.string(),
      campanhaId: z.string(),
      mensagemIndividual: z.string().optional().describe("Texto do lead; obrigatório só em campanhas individuais."),
    },
    async ({ leadId, campanhaId, mensagemIndividual }) => {
      const campanha = await getCampaign(campanhaId)
      if (!campanha) return errorResult("Campanha não encontrada.")
      if (campanha.status === "encerrada") return errorResult("A campanha está encerrada e não recebe leads.")
      if (campanha.tipo === "individual" && !textoOuNull(mensagemIndividual)) {
        return errorResult("Esta campanha é individual: informe mensagemIndividual com o texto que o lead vai receber.")
      }
      let lead
      try {
        lead = await assignCampaign(leadId, campanhaId, textoOuNull(mensagemIndividual))
      } catch (error) {
        if (error instanceof LeadNaoContatarError) return errorResult(error.message)
        throw error
      }
      if (!lead) return errorResult("Lead não encontrado.")
      return jsonResult({ ok: true, lead: (await getLead(leadId)) ?? lead })
    },
  )

  registrar(
    ctx,
    "remover_lead_da_campanha",
    "Remove o lead da campanha em que está (ele passa a 'sem_campanha'). Não exclui o lead.",
    { leadId: z.string() },
    async ({ leadId }) => {
      const lead = await assignCampaign(leadId, null)
      if (!lead) return errorResult("Lead não encontrado.")
      return jsonResult({ ok: true, lead: (await getLead(leadId)) ?? lead })
    },
  )

  registrar(
    ctx,
    "enviar_mensagem_lead",
    "Envia (via WhatsApp/Evolution) uma mensagem avulsa a um lead específico, fora da sequência de qualquer campanha. Aceita as mesmas variáveis do editor de campanhas (ex.: {{primeiro_nome}}). Confirme o texto com o usuário antes.",
    {
      leadId: z.string(),
      texto: z.string().min(1),
      instanciaNome: z.string().optional().describe("Nome opcional para validar cadastro no app; envios sempre usam a instância mais recente."),
    },
    async ({ leadId, texto, instanciaNome }) => {
      const resultado = await sendLeadMessage(leadId, texto, instanciaNome ?? null)
      if (!resultado.ok) return errorResult(resultado.message)
      return jsonResult(resultado)
    },
  )

  registrar(
    ctx,
    "excluir_lead",
    "Exclui um lead e todo o histórico dele (eventos, vínculos com campanhas). IRREVERSÍVEL: peça confirmação ao usuário antes.",
    { id: z.string(), confirmar: CONFIRMAR_EXCLUSAO },
    async ({ id }) => {
      const lead = await getLead(id)
      if (!lead) return errorResult("Lead não encontrado.")
      await deleteLead(id)
      return jsonResult({ ok: true, excluido: { id: lead.id, nome: lead.nome, telefone: lead.telefone } })
    },
  )

  // ---------------------------------------------------------------------
  // Campanhas
  // ---------------------------------------------------------------------

  registrar(
    ctx,
    "listar_campanhas",
    "Lista todas as campanhas com suas estatísticas de desempenho. Aceita filtro opcional por status.",
    { status: z.enum(STATUS_CAMPANHA_VALORES).optional() },
    async ({ status }) => {
      let campanhas = await listCampaigns()
      if (status) campanhas = campanhas.filter((campanha) => campanha.status === status)
      return jsonResult({ ok: true, total: campanhas.length, campanhas })
    },
  )

  registrar(
    ctx,
    "obter_campanha",
    "Busca uma campanha específica pelo ID, com suas estatísticas de desempenho.",
    { id: z.string() },
    async ({ id }) => {
      const campanha = await getCampaign(id)
      if (!campanha) return errorResult("Campanha não encontrada.")
      return jsonResult({ ok: true, campanha })
    },
  )

  registrar(
    ctx,
    "criar_campanha",
    "Cria uma campanha do tipo 'padrão' (uma sequência de mensagens disparada para todos os leads filtrados/selecionados).",
    {
      nome: z.string().min(1),
      descricao: z.string().optional(),
      status: z.enum(STATUS_CAMPANHA_VALORES),
      recorrenciaDias: z.number().int().min(0).describe("0 = sem recorrência (dispara a sequência uma única vez)."),
      dataFinal: z.string().nullable().optional().describe("Data ISO opcional em que a campanha encerra sozinha."),
      instanciaNome: z.string().optional().describe("Nome opcional para validar cadastro no app; envios sempre usam a instância mais recente."),
      filtroProduto: z.string().optional(),
      filtroMarca: z.string().optional(),
      filtroPersona: z.string().optional(),
      filtroRegiao: z.string().optional(),
      leadIds: z.array(z.string()).optional().describe("IDs de leads específicos a incluir, além dos filtros."),
      mensagens: z
        .array(
          z.object({
            dia: z.number().int().min(0).describe("Dia da sequência (0 = dia do início da campanha)."),
            horario: z.string().describe("Horário no formato HH:mm."),
            texto: z.string().min(1),
          }),
        )
        .min(1),
    },
    async ({ nome, descricao, status, recorrenciaDias, dataFinal, instanciaNome, filtroProduto, filtroMarca, filtroPersona, filtroRegiao, leadIds, mensagens }) => {
      const input: CampaignInput = {
        nome,
        descricao,
        status,
        tipo: "padrao",
        recorrenciaDias,
        dataFinal: dataFinal ?? null,
        instanciaNome: instanciaNome ?? null,
        filtros: {
          produto: filtroProduto ?? null,
          marca: filtroMarca ?? null,
          persona: filtroPersona ?? null,
          regiao: filtroRegiao ?? null,
        },
        leadIds,
        mensagens,
      }
      const campanha = await createCampaign(input)
      return jsonResult({ ok: true, campanha })
    },
  )

  registrar(
    ctx,
    "editar_campanha",
    "Edita uma campanha. Envie SÓ o que quer mudar. 'mensagens' substitui a sequência inteira: para manter uma mensagem existente envie o id dela (de obter_campanha); mensagens sem id são criadas e as que ficarem de fora são removidas. Se mudar os filtros sem informar leadIds, os leads são recalculados pelos filtros; caso contrário os leads atuais são mantidos. Campanhas 'individual' só aceitam nome, descrição, recorrência, data final e instância.",
    {
      id: z.string(),
      nome: z.string().min(1).optional(),
      descricao: z.string().optional(),
      status: z.enum(STATUS_CAMPANHA_VALORES).optional(),
      recorrenciaDias: z.number().int().min(0).optional(),
      dataFinal: z.string().nullable().optional().describe("Data ISO; null remove a data final."),
      instanciaNome: z.string().nullable().optional(),
      filtroProduto: z.string().nullable().optional().describe("null ou vazio remove o filtro."),
      filtroMarca: z.string().nullable().optional(),
      filtroPersona: z.string().nullable().optional(),
      filtroRegiao: z.string().nullable().optional(),
      leadIds: z.array(z.string()).optional().describe("Substitui os leads vinculados por exatamente estes."),
      mensagens: z
        .array(
          z.object({
            id: z.string().optional().describe("ID da mensagem existente a manter/atualizar."),
            dia: z.number().int().min(0),
            horario: z.string().describe("HH:mm."),
            texto: z.string().min(1),
          }),
        )
        .min(1)
        .optional(),
    },
    async (args) => {
      const atual = await getCampaign(args.id)
      if (!atual) return errorResult("Campanha não encontrada.")

      const mudouFiltro =
        args.filtroProduto !== undefined || args.filtroMarca !== undefined || args.filtroPersona !== undefined || args.filtroRegiao !== undefined
      const filtro = (novo: string | null | undefined, antigo: string | null | undefined) =>
        novo !== undefined ? textoOuNull(novo) : (antigo ?? null)

      const vinculos = await prisma.leadCampaign.findMany({ where: { campanhaId: args.id }, select: { leadId: true } })
      const idsAtuais = vinculos.map((v) => v.leadId)

      const base = {
        nome: args.nome ?? atual.nome,
        descricao: args.descricao ?? atual.descricao,
        status: args.status ?? atual.status,
        recorrenciaDias: args.recorrenciaDias ?? atual.recorrenciaDias,
        dataFinal: args.dataFinal !== undefined ? args.dataFinal : atual.dataFinal,
        instanciaNome: args.instanciaNome !== undefined ? args.instanciaNome : atual.instanciaNome,
      }

      let input: CampaignInput
      if (atual.tipo === "individual") {
        if (args.mensagens || args.leadIds || mudouFiltro) {
          return errorResult("Campanhas individuais só aceitam editar nome, descrição, status, recorrência, data final e instância por aqui.")
        }
        const individuais = await getIndividualLeadMessages(args.id)
        input = {
          ...base,
          tipo: "individual",
          filtros: atual.filtros,
          leadIds: idsAtuais,
          mensagens: [],
          leadMensagens: Object.fromEntries(Object.entries(individuais).map(([leadId, item]) => [leadId, item.mensagem])),
        }
      } else {
        input = {
          ...base,
          tipo: "padrao",
          filtros: {
            produto: filtro(args.filtroProduto, atual.filtros.produto),
            marca: filtro(args.filtroMarca, atual.filtros.marca),
            persona: filtro(args.filtroPersona, atual.filtros.persona),
            regiao: filtro(args.filtroRegiao, atual.filtros.regiao),
          },
          leadIds: args.leadIds ?? (mudouFiltro ? undefined : idsAtuais),
          mensagens: args.mensagens ?? atual.mensagens,
        }
      }

      const campanha = await updateCampaign(args.id, input)
      if (!campanha) return errorResult("Campanha não encontrada.")
      return jsonResult({ ok: true, campanha: (await getCampaign(args.id)) ?? campanha })
    },
  )

  registrar(
    ctx,
    "definir_status_campanha",
    "Ativa, pausa ou encerra uma campanha existente. Ativar dispara mensagens aos leads vinculados e encerrar fecha a campanha para os leads que não responderam: confirme com o usuário.",
    { id: z.string(), status: z.enum(STATUS_CAMPANHA_VALORES) },
    async ({ id, status }) => {
      const campanha = await setCampaignStatus(id, status)
      if (!campanha) return errorResult("Campanha não encontrada.")
      return jsonResult({ ok: true, campanha })
    },
  )

  registrar(
    ctx,
    "duplicar_campanha",
    "Cria uma cópia da campanha como rascunho (não dispara nada).",
    { id: z.string() },
    async ({ id }) => {
      const copia = await duplicateCampaign(id)
      if (!copia) return errorResult("Campanha não encontrada.")
      return jsonResult({ ok: true, campanha: copia })
    },
  )

  registrar(
    ctx,
    "excluir_campanha",
    "Exclui uma campanha. Os leads dela ficam sem campanha (os que estavam 'em_campanha' voltam a 'novo'). IRREVERSÍVEL: peça confirmação ao usuário antes.",
    { id: z.string(), confirmar: CONFIRMAR_EXCLUSAO },
    async ({ id }) => {
      const campanha = await getCampaign(id)
      if (!campanha) return errorResult("Campanha não encontrada.")
      await deleteCampaign(id)
      return jsonResult({ ok: true, excluida: { id: campanha.id, nome: campanha.nome } })
    },
  )

  // ---------------------------------------------------------------------
  // Produtos e segmentação
  // ---------------------------------------------------------------------

  registrar(
    ctx,
    "listar_produtos",
    "Lista o catálogo de produtos cadastrados para segmentação de leads e campanhas.",
    {},
    async () => {
      const produtos = await listProdutos()
      return jsonResult({ ok: true, total: produtos.length, produtos })
    },
  )

  registrar(
    ctx,
    "criar_produto",
    "Cadastra um produto no catálogo.",
    {
      nome: z.string().min(1),
      descricao: z.string().optional(),
      ativo: z.boolean().optional().describe("Padrão: true."),
      idImportacao: z.string().optional().describe("ID usado na importação de planilhas."),
    },
    async ({ nome, descricao, ativo, idImportacao }) => {
      const produto = await createProduto({ nome: nome.trim(), descricao, ativo, idImportacao })
      return jsonResult({ ok: true, produto })
    },
  )

  registrar(
    ctx,
    "editar_produto",
    "Edita um produto. Envie só o que quer mudar.",
    {
      id: z.string(),
      nome: z.string().min(1).optional(),
      descricao: z.string().nullable().optional().describe("null ou vazio limpa."),
      ativo: z.boolean().optional(),
      idImportacao: z.string().nullable().optional(),
    },
    async ({ id, nome, descricao, ativo, idImportacao }) => {
      const atual = (await listProdutos()).find((p) => p.id === id)
      if (!atual) return errorResult("Produto não encontrado.")
      const produto = await updateProduto(id, {
        nome: nome?.trim() || atual.nome,
        descricao: descricao !== undefined ? descricao : atual.descricao,
        ativo: ativo ?? atual.ativo,
        ...(idImportacao !== undefined ? { idImportacao } : {}),
      })
      if (!produto) return errorResult("Produto não encontrado.")
      return jsonResult({ ok: true, produto })
    },
  )

  registrar(
    ctx,
    "excluir_produto",
    "Exclui um produto do catálogo. Leads que já usam o nome dele continuam com o texto. Peça confirmação ao usuário antes.",
    { id: z.string(), confirmar: CONFIRMAR_EXCLUSAO },
    async ({ id }) => {
      const atual = (await listProdutos()).find((p) => p.id === id)
      if (!atual) return errorResult("Produto não encontrado.")
      await deleteProduto(id)
      return jsonResult({ ok: true, excluido: { id: atual.id, nome: atual.nome } })
    },
  )

  registrar(
    ctx,
    "listar_segmentacao",
    "Lista as marcas, personas ou regiões cadastradas (use o parâmetro tipo).",
    { tipo: TIPO_SEGMENTACAO },
    async ({ tipo }) => {
      const itens = await SERVICOS_SEGMENTACAO[tipo].listar()
      return jsonResult({ ok: true, tipo, total: itens.length, itens })
    },
  )

  registrar(
    ctx,
    "criar_item_segmentacao",
    "Cadastra uma marca, persona ou região.",
    {
      tipo: TIPO_SEGMENTACAO,
      nome: z.string().min(1),
      descricao: z.string().optional(),
      ativo: z.boolean().optional().describe("Padrão: true."),
      idImportacao: z.string().optional(),
    },
    async ({ tipo, nome, descricao, ativo, idImportacao }) => {
      const item = await SERVICOS_SEGMENTACAO[tipo].criar({ nome: nome.trim(), descricao, ativo, idImportacao })
      return jsonResult({ ok: true, tipo, item })
    },
  )

  registrar(
    ctx,
    "editar_item_segmentacao",
    "Edita uma marca, persona ou região. Envie só o que quer mudar.",
    {
      tipo: TIPO_SEGMENTACAO,
      id: z.string(),
      nome: z.string().min(1).optional(),
      descricao: z.string().nullable().optional().describe("null ou vazio limpa."),
      ativo: z.boolean().optional(),
      idImportacao: z.string().nullable().optional(),
    },
    async ({ tipo, id, nome, descricao, ativo, idImportacao }) => {
      const servico = SERVICOS_SEGMENTACAO[tipo]
      const atual = (await servico.listar()).find((item) => item.id === id)
      if (!atual) return errorResult("Item não encontrado.")
      const item = await servico.atualizar(id, {
        nome: nome?.trim() || atual.nome,
        descricao: descricao !== undefined ? descricao : atual.descricao,
        ativo: ativo ?? atual.ativo,
        ...(idImportacao !== undefined ? { idImportacao } : {}),
      })
      if (!item) return errorResult("Item não encontrado.")
      return jsonResult({ ok: true, tipo, item })
    },
  )

  registrar(
    ctx,
    "excluir_item_segmentacao",
    "Exclui uma marca, persona ou região do catálogo. Peça confirmação ao usuário antes.",
    { tipo: TIPO_SEGMENTACAO, id: z.string(), confirmar: CONFIRMAR_EXCLUSAO },
    async ({ tipo, id }) => {
      const servico = SERVICOS_SEGMENTACAO[tipo]
      const atual = (await servico.listar()).find((item) => item.id === id)
      if (!atual) return errorResult("Item não encontrado.")
      await servico.excluir(id)
      return jsonResult({ ok: true, tipo, excluido: { id: atual.id, nome: atual.nome } })
    },
  )

  // ---------------------------------------------------------------------
  // Indicadores e eventos
  // ---------------------------------------------------------------------

  registrar(
    ctx,
    "obter_indicadores",
    "Retorna os KPIs principais do painel: leads ativos, campanhas ativas, mensagens hoje, taxa de resposta e taxa de qualificação (com variação em relação ao dia anterior).",
    {},
    async () => jsonResult({ ok: true, indicadores: await getKpis() }),
  )

  registrar(
    ctx,
    "listar_respostas_lead",
    "Lista respostas recebidas dos leads, incluindo o perfil completo do lead, campanha, data e hora, e o conteúdo da resposta quando disponível. Pode filtrar por lead ou campanha.",
    {
      leadId: z.string().optional().describe("Filtra pelo ID do lead."),
      campanhaId: z.string().optional().describe("Filtra pelo ID da campanha."),
      limite: z.number().int().min(1).max(200).optional().describe("Máximo de respostas; padrão: 50."),
    },
    async ({ leadId, campanhaId, limite }) => {
      const respostas = await listLeadResponses({ limit: limite ?? 50, leadId, campanhaId })
      return jsonResult({ ok: true, total: respostas.length, respostas })
    },
  )

  registrar(
    ctx,
    "obter_envio",
    "Busca um envio de mensagem pelo ID do evento retornado na listagem de eventos, incluindo o texto integral enviado e os dados relacionados.",
    { id: z.string().describe("ID do evento do envio.") },
    async ({ id }) => {
      const envio = await getEvent(id)
      if (!envio || envio.tipo !== "mensagem_enviada") return errorResult("Envio não encontrado.")
      return jsonResult({ ok: true, envio })
    },
  )

  registrar(
    ctx,
    "listar_eventos_recentes",
    "Lista os eventos mais recentes da linha do tempo (mensagens enviadas, falhas, respostas, entradas/saídas de campanha).",
    { limite: z.number().int().min(1).max(200).optional().describe("Padrão: 50.") },
    async ({ limite }) => {
      const eventos = await listEvents(limite ?? 50)
      return jsonResult({ ok: true, total: eventos.length, eventos })
    },
  )

  // ---------------------------------------------------------------------
  // Kanban (plugin Kanban)
  // ---------------------------------------------------------------------

  registrar(
    ctx,
    "obter_quadro_kanban",
    "Mostra o quadro Kanban: total de leads por coluna (a coluna é o status do lead) e os leads mais recentes de cada uma, além das campanhas que aceitam novos leads.",
    {
      status: z.enum(STATUS_LEAD_VALORES).optional().describe("Mostra só esta coluna."),
      limite: z.number().int().min(1).max(100).optional().describe("Leads por coluna; padrão: 25."),
    },
    async ({ status, limite }) => {
      const quadro = await getKanbanBoard()
      const porColuna = limite ?? 25
      const colunas: Record<string, unknown[]> = {}
      for (const coluna of status ? [status] : STATUS_LEAD_VALORES) {
        colunas[coluna] = quadro.leads.filter((lead) => lead.status === coluna).slice(0, porColuna)
      }
      return jsonResult({ ok: true, totais: quadro.totais, campanhasDisponiveis: quadro.campanhas, colunas })
    },
  )

  registrar(
    ctx,
    "mover_lead_kanban",
    "Move um lead de coluna no Kanban (muda o status com as mesmas regras do painel). Para 'em_campanha' informe campanhaId (e mensagemIndividual se a campanha for individual). Para 'respondeu' pode informar a resposta.",
    {
      leadId: z.string(),
      status: z.enum(STATUS_LEAD_VALORES),
      campanhaId: z.string().optional(),
      mensagemIndividual: z.string().optional(),
      resposta: z.string().optional(),
    },
    async ({ leadId, status, campanhaId, mensagemIndividual, resposta }) => {
      const resultado = await moverLeadKanban(leadId, status, { campanhaId, mensagemIndividual, resposta })
      if (!resultado.ok) return errorResult(resultado.message)
      return jsonResult({ ok: true, mensagem: resultado.message, lead: await getLead(leadId) })
    },
  )

  // ---------------------------------------------------------------------
  // Chat (plugin Chat)
  // ---------------------------------------------------------------------

  registrar(
    ctx,
    "listar_conversas_chat",
    "Lista as conversas do chat (o id da conversa é o id do lead), da mais recente para a mais antiga, com a última mensagem e o responsável (se o CRM estiver ativo).",
    {
      busca: z.string().optional().describe("Filtra por nome ou telefone."),
      departamentoId: z.string().optional().describe("Só conversas deste departamento (plugin CRM)."),
      limite: z.number().int().min(1).max(100).optional().describe("Padrão: 30."),
    },
    async ({ busca, departamentoId, limite }) => {
      const { conversas } = await getChatInbox(null, { semMensagens: true })
      const termo = busca?.trim().toLowerCase()
      const filtradas = conversas.filter((conversa) => {
        if (departamentoId && conversa.atendimento?.departamentoId !== departamentoId) return false
        if (!termo) return true
        return conversa.nome.toLowerCase().includes(termo) || conversa.telefone.includes(termo)
      })
      const itens = filtradas.slice(0, limite ?? 30)
      return jsonResult({ ok: true, total: filtradas.length, quantidade: itens.length, conversas: itens })
    },
  )

  registrar(
    ctx,
    "obter_mensagens_chat",
    "Lê o histórico de uma conversa (mensagens enviadas, respostas e notas internas), em ordem cronológica.",
    {
      leadId: z.string().describe("ID do lead (= id da conversa)."),
      limite: z.number().int().min(1).max(200).optional().describe("Quantas mensagens mais recentes; padrão: 50."),
    },
    async ({ leadId, limite }) => {
      const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, nome: true } })
      if (!lead) return errorResult("Lead não encontrado.")
      const mensagens = await getChatMessages(leadId)
      return jsonResult({ ok: true, lead, total: mensagens.length, mensagens: mensagens.slice(-(limite ?? 50)) })
    },
  )

  registrar(
    ctx,
    "adicionar_nota_chat",
    "Adiciona uma nota interna na conversa (só a equipe vê; não é enviada ao cliente).",
    { leadId: z.string(), texto: z.string().min(1).max(5000) },
    async ({ leadId, texto }) => {
      const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } })
      if (!lead) return errorResult("Lead não encontrado.")
      const nota = await addChatInternalNote(leadId, texto.trim(), AUTOR_MCP)
      return jsonResult({ ok: true, notaId: nota.id })
    },
  )

  // ---------------------------------------------------------------------
  // CRM (plugin CRM)
  // ---------------------------------------------------------------------

  registrar(
    ctx,
    "listar_departamentos",
    "Lista os departamentos (com atendentes, conversas, bots e agente de IA vinculado) e os bots de entrada.",
    {},
    async () => {
      const dados = await getCrmData({ id: EXECUTOR_MCP.id, role: EXECUTOR_MCP.role })
      return jsonResult({
        ok: true,
        departamentos: dados.departamentos,
        botsEntrada: dados.botsEntrada,
        agenteIaEntradaId: dados.agenteIaEntradaId,
      })
    },
  )

  registrar(
    ctx,
    "criar_departamento",
    "Cria um departamento de atendimento.",
    { nome: z.string().min(2).max(60), descricao: z.string().max(200).optional(), ativo: z.boolean().optional().describe("Padrão: true.") },
    async ({ nome, descricao, ativo }) => {
      await createDepartamento({ nome, descricao: descricao ?? null, ativo: ativo ?? true })
      return jsonResult({ ok: true, mensagem: `Departamento “${nome.trim()}” criado. Use listar_departamentos para ver o ID.` })
    },
  )

  registrar(
    ctx,
    "editar_departamento",
    "Edita um departamento (nome, descrição ou ativo/inativo). Envie só o que quer mudar.",
    {
      id: z.string(),
      nome: z.string().min(2).max(60).optional(),
      descricao: z.string().max(200).nullable().optional().describe("null ou vazio limpa."),
      ativo: z.boolean().optional(),
    },
    async ({ id, nome, descricao, ativo }) => {
      const atual = await prisma.departamento.findUnique({ where: { id }, select: { nome: true, descricao: true, ativo: true } })
      if (!atual) return errorResult("Departamento não encontrado.")
      await updateDepartamento(id, {
        nome: nome ?? atual.nome,
        descricao: descricao !== undefined ? descricao : atual.descricao,
        ativo: ativo ?? atual.ativo,
      })
      return jsonResult({ ok: true, mensagem: "Departamento atualizado." })
    },
  )

  registrar(
    ctx,
    "excluir_departamento",
    "Exclui um departamento: as conversas dele ficam sem departamento, os bots dele são desativados e os vínculos com atendentes somem. IRREVERSÍVEL: peça confirmação ao usuário antes.",
    { id: z.string(), confirmar: CONFIRMAR_EXCLUSAO },
    async ({ id }) => {
      const resultado = await deleteDepartamento(id)
      return jsonResult({ ok: true, mensagem: "Departamento excluído.", conversasSemDepartamento: resultado.conversas })
    },
  )

  registrar(
    ctx,
    "listar_atendentes",
    "Lista os atendentes (perfil de atendimento dos usuários), com departamentos e quantidade de conversas.",
    {},
    async () => {
      const dados = await getCrmData({ id: EXECUTOR_MCP.id, role: EXECUTOR_MCP.role })
      return jsonResult({ ok: true, total: dados.atendentes.length, atendentes: dados.atendentes })
    },
  )

  registrar(
    ctx,
    "definir_atendente_ativo",
    "Ativa ou inativa um atendente (inativo não recebe conversas). Criar, editar ou excluir atendentes/logins não é feito pelo MCP.",
    { id: z.string().describe("ID do atendente (de listar_atendentes)."), ativo: z.boolean() },
    async ({ id, ativo }) => {
      await setAtendenteAtivo(id, ativo)
      return jsonResult({ ok: true, mensagem: ativo ? "Atendente ativado." : "Atendente inativado." })
    },
  )

  registrar(
    ctx,
    "transferir_conversa",
    "Transfere a conversa de um lead para um departamento e/ou atendente (o atendente precisa pertencer ao departamento). Sem departamento e sem atendente, remove o vínculo. Fica registrado na conversa como nota interna.",
    {
      leadId: z.string(),
      departamentoId: z.string().nullable().optional(),
      atendenteId: z.string().nullable().optional(),
      motivo: z.string().max(500).optional(),
    },
    async ({ leadId, departamentoId, atendenteId, motivo }) => {
      const { para } = await transferirConversa(leadId, { departamentoId, atendenteId, motivo }, EXECUTOR_MCP)
      return jsonResult({ ok: true, mensagem: `Conversa transferida para ${para}.` })
    },
  )

  registrar(
    ctx,
    "enviar_lead_para_campanha_chat",
    "Envia o lead de uma conversa para uma campanha (registra nota interna no chat). Em campanhas individuais informe mensagemIndividual. Se a campanha não estiver ativa, o lead entra mas nada é enviado até ela ser ativada.",
    { leadId: z.string(), campanhaId: z.string(), mensagemIndividual: z.string().optional() },
    async ({ leadId, campanhaId, mensagemIndividual }) => {
      const resultado = await enviarLeadParaCampanha({ leadId, campanhaId, mensagemIndividual, autor: AUTOR_MCP })
      return jsonResult({ ok: true, ...resultado })
    },
  )

  registrar(
    ctx,
    "criar_bot",
    "Cria um bot (fluxo No Code do tipo bot). Sem departamentoId vira o bot de entrada (triagem). Nasce DESATIVADO; é editado no No Code.",
    { nome: z.string().min(2).max(80), departamentoId: z.string().nullable().optional() },
    async ({ nome, departamentoId }) => {
      const { id } = await criarBotDoCrm({ nome, departamentoId: departamentoId ?? null })
      return jsonResult({ ok: true, id, mensagem: "Bot criado (desativado)." })
    },
  )

  registrar(
    ctx,
    "definir_bot_ativo",
    "Ativa ou desativa um bot. Só um bot fica ativo por escopo (entrada ou departamento): ao ativar, o outro do mesmo escopo é desativado.",
    { id: z.string(), ativo: z.boolean() },
    async ({ id, ativo }) => {
      const { desativados } = await ativarBotDoCrm(id, ativo)
      return jsonResult({ ok: true, ativo, botsDesativadosNoEscopo: desativados })
    },
  )

  registrar(
    ctx,
    "excluir_bot",
    "Exclui um bot. IRREVERSÍVEL: peça confirmação ao usuário antes.",
    { id: z.string(), confirmar: CONFIRMAR_EXCLUSAO },
    async ({ id }) => {
      await excluirBotDoCrm(id)
      return jsonResult({ ok: true, mensagem: "Bot excluído." })
    },
  )

  // ---------------------------------------------------------------------
  // No Code (plugin No Code)
  // ---------------------------------------------------------------------

  const resumoFluxo = (fluxo: Awaited<ReturnType<typeof getFlow>> & object) => ({
    id: fluxo.id,
    nome: fluxo.nome,
    tipo: fluxo.tipo,
    ativo: fluxo.ativo,
    sistema: fluxo.sistema,
    botEntrada: fluxo.botEntrada,
    departamentoNome: fluxo.departamentoNome,
    totalBlocos: fluxo.nodes.length,
    atualizadoEm: fluxo.atualizadoEm,
  })

  registrar(ctx, "listar_fluxos_nocode", "Lista os fluxos do No Code (automações e bots) em resumo, sem os blocos.", {}, async () => {
    const fluxos = await listFlows()
    return jsonResult({ ok: true, total: fluxos.length, fluxos: fluxos.map(resumoFluxo) })
  })

  registrar(
    ctx,
    "obter_fluxo_nocode",
    "Obtém um fluxo completo, com blocos (nodes) e ligações (edges). Use antes de editar_fluxo_nocode.",
    { id: z.string() },
    async ({ id }) => {
      const fluxo = await getFlow(id)
      if (!fluxo) return errorResult("Fluxo não encontrado.")
      return jsonResult({ ok: true, fluxo })
    },
  )

  registrar(
    ctx,
    "listar_execucoes_fluxo",
    "Lista as execuções de um fluxo, da mais recente para a mais antiga (no fluxo de resposta, só as últimas 24h).",
    {
      flowId: z.string(),
      limite: z.number().int().min(1).max(50).optional().describe("Padrão: 20."),
      depoisDeId: z.string().optional().describe("ID da última execução da página anterior, para continuar."),
    },
    async ({ flowId, limite, depoisDeId }) => {
      const fluxo = await getFlow(flowId)
      if (!fluxo) return errorResult("Fluxo não encontrado.")
      const [execucoes, total] = await Promise.all([listExecutions(flowId, { limite: limite ?? 20, depoisDeId }), contarExecucoes(flowId)])
      return jsonResult({ ok: true, fluxo: fluxo.nome, total, quantidade: execucoes.length, execucoes })
    },
  )

  registrar(
    ctx,
    "criar_fluxo_nocode",
    "Cria um fluxo do No Code (automação), desativado. modelo 'resposta' parte do fluxo de resposta padrão; 'vazio' cria sem blocos.",
    { nome: z.string().min(1).max(80), modelo: z.enum(["resposta", "vazio"]).optional().describe("Padrão: vazio.") },
    async ({ nome, modelo }) => {
      const base = modelo === "resposta" ? modeloFluxoResposta() : { nodes: [], edges: [] }
      const fluxo = await createFlow({ nome: nome.trim(), ...base })
      return jsonResult({ ok: true, fluxo: resumoFluxo(fluxo) })
    },
  )

  registrar(
    ctx,
    "editar_fluxo_nocode",
    "Edita um fluxo: renomeia e/ou substitui blocos (nodes) e ligações (edges). Ao enviar nodes/edges, mande o grafo COMPLETO (obtido em obter_fluxo_nocode, já com a alteração). Fluxos ativos precisam continuar válidos (com gatilho).",
    {
      id: z.string(),
      nome: z.string().min(1).max(80).optional(),
      nodes: z.array(z.record(z.string(), z.unknown())).max(100).optional(),
      edges: z.array(z.record(z.string(), z.unknown())).optional(),
    },
    async ({ id, nome, nodes, edges }) => {
      const atual = await getFlow(id)
      if (!atual) return errorResult("Fluxo não encontrado.")

      const nomeFinal = (nome ?? atual.nome).trim()
      if (!nomeFinal || nomeFinal.length > 80) return errorResult("Informe um nome de até 80 caracteres.")

      const nodesFinais = (nodes ?? atual.nodes) as unknown as FlowNode[]
      const edgesFinais = (edges ?? atual.edges) as unknown as FlowEdge[]
      const invalido = validarGrafo(nodesFinais, edgesFinais, false, atual.tipo)
      if (invalido) return errorResult(invalido)

      // Fluxo ativo (e o do sistema, sempre ativo) precisa continuar válido, com gatilho.
      if (atual.ativo || atual.sistema) {
        const semGatilho = validarGrafo(nodesFinais, edgesFinais, true, atual.tipo)
        if (semGatilho) return errorResult(atual.sistema ? semGatilho : `${semGatilho} Desative o fluxo para salvar assim.`)
      }
      if (atual.sistema) {
        // Sem o token no gatilho a Evolution não consegue mais entregar os eventos.
        const gatilho = nodesFinais.find((n) => n.type === "webhook")
        if (!String(gatilho?.config?.token ?? "").trim()) {
          return errorResult("O gatilho Webhook do fluxo de resposta precisa ter um token.")
        }
      }

      const fluxo = await updateFlow(id, { nome: nomeFinal, nodes: nodesFinais, edges: edgesFinais })
      return jsonResult({ ok: true, fluxo: resumoFluxo(fluxo) })
    },
  )

  registrar(
    ctx,
    "definir_fluxo_nocode_ativo",
    "Ativa ou desativa um fluxo. O fluxo de resposta do sistema não pode ser desativado. Para bots, ativar desativa o outro bot do mesmo escopo.",
    { id: z.string(), ativo: z.boolean() },
    async ({ id, ativo }) => {
      const fluxo = await getFlow(id)
      if (!fluxo) return errorResult("Fluxo não encontrado.")
      if (fluxo.sistema) {
        return ativo ? jsonResult({ ok: true, ativo: true, mensagem: "O fluxo de resposta já fica sempre ativo." }) : errorResult(MSG_FLUXO_SISTEMA_DESATIVAR)
      }
      if (fluxo.tipo === "bot") {
        const { desativados } = await ativarBotDoCrm(id, ativo)
        return jsonResult({ ok: true, ativo, botsDesativadosNoEscopo: desativados })
      }
      if (ativo) {
        const invalido = validarGrafo(fluxo.nodes, fluxo.edges, true)
        if (invalido) return errorResult(invalido)
      }
      await updateFlow(id, { ativo })
      return jsonResult({ ok: true, ativo })
    },
  )

  registrar(
    ctx,
    "excluir_fluxo_nocode",
    "Exclui um fluxo do No Code. O fluxo de resposta do sistema não pode ser excluído. IRREVERSÍVEL: peça confirmação ao usuário antes.",
    { id: z.string(), confirmar: CONFIRMAR_EXCLUSAO },
    async ({ id }) => {
      const fluxo = await getFlow(id)
      if (!fluxo) return errorResult("Fluxo não encontrado.")
      if (fluxo.sistema) return errorResult(MSG_FLUXO_SISTEMA_EXCLUIR)
      await deleteFlow(id)
      return jsonResult({ ok: true, excluido: { id: fluxo.id, nome: fluxo.nome } })
    },
  )

  // ---------------------------------------------------------------------
  // Agentes de IA (plugin Agentes de IA)
  // ---------------------------------------------------------------------

  registrar(
    ctx,
    "listar_agentes_ia",
    "Lista os agentes de IA (provedor, modelo, prompt, departamentos vinculados). A chave de API nunca é devolvida inteira, só o final.",
    {},
    async () => {
      const agentes = await listarAgentes()
      return jsonResult({ ok: true, total: agentes.length, agentes })
    },
  )

  registrar(
    ctx,
    "criar_agente_ia",
    "Cria um agente de IA que responde as conversas do chat. Nasce DESATIVADO; depois ative e vincule a um departamento ou como agente de entrada.",
    {
      nome: z.string().min(1).max(80),
      provedor: z.enum(PROVEDORES_VALORES).describe("Provedor da API."),
      baseUrl: z.string().nullable().optional().describe("Só para o provedor 'compativel'."),
      modelo: z.string().min(1),
      prompt: z.string().min(1).describe("Instruções do agente."),
      apiKey: z.string().min(1).describe("Chave de API do provedor."),
      reativarAposMinutos: z.number().int().nullable().optional().describe("Reativação automática após X minutos sem atividade da equipe."),
    },
    async ({ nome, provedor, baseUrl, modelo, prompt, apiKey, reativarAposMinutos }) => {
      const { id } = await criarAgente({ nome, provedor, baseUrl, modelo, prompt, apiKey, reativarAposMinutos })
      return jsonResult({ ok: true, id, mensagem: "Agente criado (desativado)." })
    },
  )

  registrar(
    ctx,
    "editar_agente_ia",
    "Edita um agente de IA. Envie só o que quer mudar. Ao trocar de provedor é obrigatório enviar a nova apiKey.",
    {
      id: z.string(),
      nome: z.string().min(1).max(80).optional(),
      provedor: z.enum(PROVEDORES_VALORES).optional(),
      baseUrl: z.string().nullable().optional(),
      modelo: z.string().min(1).optional(),
      prompt: z.string().min(1).optional(),
      apiKey: z.string().min(1).optional().describe("Só envie para trocar a chave."),
      reativarAposMinutos: z.number().int().nullable().optional(),
    },
    async ({ id, nome, provedor, baseUrl, modelo, prompt, apiKey, reativarAposMinutos }) => {
      const atual = (await listarAgentes()).find((agente) => agente.id === id)
      if (!atual) return errorResult("Agente não encontrado.")
      await atualizarAgente(id, {
        nome: nome ?? atual.nome,
        provedor: provedor ?? atual.provedor,
        baseUrl: baseUrl !== undefined ? baseUrl : atual.baseUrl,
        modelo: modelo ?? atual.modelo,
        prompt: prompt ?? atual.prompt,
        apiKey: apiKey ?? null,
        reativarAposMinutos: reativarAposMinutos !== undefined ? reativarAposMinutos : atual.reativarAposMinutos,
      })
      return jsonResult({ ok: true, mensagem: "Agente atualizado." })
    },
  )

  registrar(
    ctx,
    "definir_agente_ia_ativo",
    "Ativa ou desativa um agente de IA. Para ativar o agente precisa ter chave de API e prompt.",
    { id: z.string(), ativo: z.boolean() },
    async ({ id, ativo }) => {
      await ativarAgente(id, ativo)
      return jsonResult({ ok: true, ativo })
    },
  )

  registrar(
    ctx,
    "excluir_agente_ia",
    "Exclui um agente de IA. IRREVERSÍVEL: peça confirmação ao usuário antes.",
    { id: z.string(), confirmar: CONFIRMAR_EXCLUSAO },
    async ({ id }) => {
      const atual = (await listarAgentes()).find((agente) => agente.id === id)
      if (!atual) return errorResult("Agente não encontrado.")
      await excluirAgente(id)
      return jsonResult({ ok: true, excluido: { id: atual.id, nome: atual.nome } })
    },
  )

  registrar(
    ctx,
    "vincular_agente_departamento",
    "Liga um agente de IA a um departamento (ele passa a responder as conversas dele). Com agenteId nulo, desliga o agente do departamento.",
    { departamentoId: z.string(), agenteId: z.string().nullable() },
    async ({ departamentoId, agenteId }) => {
      await vincularAgenteAoDepartamento(departamentoId, agenteId)
      return jsonResult({ ok: true, mensagem: agenteId ? "Agente vinculado ao departamento." : "Agente desvinculado do departamento." })
    },
  )

  registrar(
    ctx,
    "definir_agente_entrada",
    "Define o agente de IA de entrada (atende quem ainda não está em nenhum departamento). Só um por instância; com agenteId nulo, remove.",
    { agenteId: z.string().nullable() },
    async ({ agenteId }) => {
      await definirAgenteDeEntrada(agenteId)
      return jsonResult({ ok: true, mensagem: agenteId ? "Agente de entrada definido." : "Agente de entrada removido." })
    },
  )

  return server
}
