import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { validarTelefoneBR } from "@/lib/telefone"
import { recordAppLog } from "@/services/app-logs"
import { listProdutos } from "@/services/produtos"
import { getKpis } from "@/services/analytics"
import { getEvent, listEvents, listLeadResponses } from "@/services/events"
import {
  createLead,
  getLead,
  LeadValidationError,
  listLeads,
  getLeadTimeline,
  sendLeadMessage,
  setLeadStatus,
  updateLeadNotes,
  countLeads,
  type LeadInput,
} from "@/services/leads"
import {
  createCampaign,
  getCampaign,
  listCampaigns,
  setCampaignStatus,
  type CampaignInput,
} from "@/services/campaigns"
import type { CampaignStatus, LeadStatus } from "@/types"
import { emitWebhookEvent } from "@/services/webhooks"

/**
 * Servidor MCP (Model Context Protocol) do painel.
 *
 * Expõe, como "tools" que um cliente MCP (Claude, por exemplo) pode chamar, um
 * subconjunto das mesmas operações já disponíveis em `/api/*` — ver
 * `services/*` para a lógica de negócio real, que é 100% reaproveitada aqui.
 *
 * A conexão em si (autenticação, transporte HTTP) é tratada em
 * `app/api/mcp/route.ts`; este arquivo só descreve as tools.
 *
 * Uma instância nova é criada a cada requisição (modo stateless — ver a
 * rota), então este módulo não deve guardar estado entre chamadas.
 */

const STATUS_LEAD_VALORES: [LeadStatus, ...LeadStatus[]] = [
  "novo",
  "em_campanha",
  "sem_campanha",
  "respondeu",
  "encerrado",
]

const STATUS_CAMPANHA_VALORES: [CampaignStatus, ...CampaignStatus[]] = [
  "rascunho",
  "ativa",
  "pausada",
  "encerrada",
]

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

async function registrarAuditoriaMcp(
  ferramenta: string,
  argumentos: unknown,
  sucesso: boolean,
  erro?: string,
): Promise<void> {
  const executadoEm = new Date().toISOString()
  let argumentosJson = "{}"
  try {
    argumentosJson = JSON.stringify(argumentos) ?? "{}"
  } catch {
    argumentosJson = "[argumentos não serializáveis]"
  }
  const argumentosLimitados =
    argumentosJson.length > 4000 ? `${argumentosJson.slice(0, 4000)} [truncado]` : argumentosJson
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

function registerAuditedTool<const Args extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  config: {
    title?: string
    description?: string
    inputSchema: Args
  },
  callback: ToolCallback<Args>,
): void {
  const auditedCallback = async (args: unknown, extra: unknown) => {
    try {
      const resultado = await callback(args as never, extra as never)
      await registrarAuditoriaMcp(name, args, !resultado.isError, resultado.isError ? "A ferramenta retornou erro." : undefined)
      return resultado
    } catch (error) {
      await registrarAuditoriaMcp(name, args, false, error instanceof Error ? error.message : String(error))
      throw error
    }
  }
  server.registerTool<Args, Args>(name, config, auditedCallback as unknown as ToolCallback<Args>)
}

export function createAppMcpServer(): McpServer {
  const server = new McpServer({
    name: "engine-followup",
    version: "1.0.0",
    title: "Painel de Campanhas (Engine Follow-up)",
  })

  // ---------------------------------------------------------------------
  // Leads
  // ---------------------------------------------------------------------

  registerAuditedTool(
    server,
    "listar_leads",
    {
      title: "Listar leads",
      description:
        "Lista até 50 leads por página com agregações de mensagens e respostas. Informe pagina (padrão: 1); o resultado indica quando existe próxima página. Aceita filtros por campanha, status e termo de busca por nome ou telefone.",
      inputSchema: {
        campanhaId: z.string().optional().describe("Filtra leads associados à campanha, incluindo histórico de eventos."),
        status: z
          .enum(STATUS_LEAD_VALORES)
          .optional()
          .describe("Filtra pelo status do lead."),
        busca: z.string().optional().describe("Filtra por nome ou telefone contendo este texto."),
        pagina: z.number().int().min(1).optional().describe("Página de resultados; padrão: 1."),
      },
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

  registerAuditedTool(
    server,
    "buscar_negocio_bdr",
    {
      title: "Buscar negócio no BDR",
      description:
        "Localiza no cadastro do painel os leads cujo campo negocio corresponde exatamente ao identificador informado e retorna cada perfil completo com sua timeline. Não consulta um BDR externo; usa o vínculo local registrado no lead.",
      inputSchema: { negocio: z.string().min(1).describe("ID do negócio registrado no campo negocio do lead.") },
    },
    async ({ negocio }) => {
      const negocioId = negocio.trim()
      if (!negocioId) return errorResult("Informe o ID do negócio.")
      const leads = await listLeads({ negocio: negocioId })
      const relacionados = await Promise.all(
        leads.map(async (lead) => ({ lead, timeline: await getLeadTimeline(lead.id) })),
      )
      return jsonResult({ ok: true, negocio: negocioId, total: relacionados.length, relacionados })
    },
  )

  registerAuditedTool(
    server,
    "obter_lead",
    {
      title: "Obter lead",
      description: "Busca um lead específico pelo ID, incluindo sua linha do tempo de eventos.",
      inputSchema: { id: z.string().describe("ID do lead.") },
    },
    async ({ id }) => {
      const lead = await getLead(id)
      if (!lead) return errorResult("Lead não encontrado.")
      const timeline = await getLeadTimeline(id)
      return jsonResult({ ok: true, lead, timeline })
    },
  )

  registerAuditedTool(
    server,
    "criar_lead",
    {
      title: "Criar lead",
      description:
        "Cadastra um novo lead. Apenas nome e telefone (com DDI 55) são obrigatórios; as demais dimensões de segmentação são texto livre e opcionais.",
      inputSchema: {
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
    },
    async ({ nome, telefone, produto, marca, persona, regiao, notas, negocio, status, campanhaId }) => {
      const telefoneValidado = validarTelefoneBR(telefone)
      if (!telefoneValidado.ok) {
        return errorResult(telefoneValidado.erro ?? "Telefone inválido.")
      }
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
        if (error instanceof LeadValidationError) {
          return errorResult("Corrija os campos destacados.", { errors: error.errors })
        }
        throw error
      }
    },
  )

  registerAuditedTool(
    server,
    "atualizar_status_lead",
    {
      title: "Atualizar status do lead",
      description:
        "Altera o status de um lead. Ao marcar como 'respondeu', o lead sai automaticamente de todas as campanhas em que estava.",
      inputSchema: {
        id: z.string().describe("ID do lead."),
        status: z.enum(STATUS_LEAD_VALORES),
        resposta: z.string().optional().describe("Texto opcional do que o lead respondeu."),
      },
    },
    async ({ id, status, resposta }) => {
      const lead = await setLeadStatus(id, status, resposta ?? null)
      if (!lead) return errorResult("Lead não encontrado.")
      return jsonResult({ ok: true, lead: (await getLead(lead.id)) ?? lead })
    },
  )

  registerAuditedTool(
    server,
    "anotar_lead",
    {
      title: "Anotar lead",
      description: "Substitui as anotações internas de um lead pelo texto informado.",
      inputSchema: { id: z.string(), notas: z.string() },
    },
    async ({ id, notas }) => {
      const lead = await updateLeadNotes(id, notas)
      if (!lead) return errorResult("Lead não encontrado.")
      return jsonResult({ ok: true, lead: (await getLead(lead.id)) ?? lead })
    },
  )

  registerAuditedTool(
    server,
    "enviar_mensagem_lead",
    {
      title: "Enviar mensagem avulsa a um lead",
      description:
        "Envia (via WhatsApp/Evolution) uma mensagem avulsa a um lead específico, fora da sequência de qualquer campanha. Aceita as mesmas variáveis do editor de campanhas (ex.: {{primeiro_nome}}).",
      inputSchema: {
        leadId: z.string(),
        texto: z.string().min(1),
        instanciaNome: z.string().optional().describe("Nome opcional para validar cadastro no app; envios sempre usam a instância mais recente."),
      },
    },
    async ({ leadId, texto, instanciaNome }) => {
      const resultado = await sendLeadMessage(leadId, texto, instanciaNome ?? null)
      if (!resultado.ok) return errorResult(resultado.message)
      return jsonResult(resultado)
    },
  )

  // ---------------------------------------------------------------------
  // Campanhas
  // ---------------------------------------------------------------------

  registerAuditedTool(
    server,
    "listar_campanhas",
    {
      title: "Listar campanhas",
      description: "Lista todas as campanhas com suas estatísticas de desempenho. Aceita filtro opcional por status.",
      inputSchema: { status: z.enum(STATUS_CAMPANHA_VALORES).optional() },
    },
    async ({ status }) => {
      let campanhas = await listCampaigns()
      if (status) campanhas = campanhas.filter((campanha) => campanha.status === status)
      return jsonResult({ ok: true, total: campanhas.length, campanhas })
    },
  )

  registerAuditedTool(
    server,
    "obter_campanha",
    {
      title: "Obter campanha",
      description: "Busca uma campanha específica pelo ID, com suas estatísticas de desempenho.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const campanha = await getCampaign(id)
      if (!campanha) return errorResult("Campanha não encontrada.")
      return jsonResult({ ok: true, campanha })
    },
  )

  registerAuditedTool(
    server,
    "criar_campanha",
    {
      title: "Criar campanha",
      description:
        "Cria uma campanha do tipo 'padrão' (uma sequência de mensagens disparada para todos os leads filtrados/selecionados).",
      inputSchema: {
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
    },
    async ({
      nome,
      descricao,
      status,
      recorrenciaDias,
      dataFinal,
      instanciaNome,
      filtroProduto,
      filtroMarca,
      filtroPersona,
      filtroRegiao,
      leadIds,
      mensagens,
    }) => {
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

  registerAuditedTool(
    server,
    "definir_status_campanha",
    {
      title: "Definir status da campanha",
      description: "Ativa, pausa ou encerra uma campanha existente.",
      inputSchema: { id: z.string(), status: z.enum(STATUS_CAMPANHA_VALORES) },
    },
    async ({ id, status }) => {
      const campanha = await setCampaignStatus(id, status)
      if (!campanha) return errorResult("Campanha não encontrada.")
      return jsonResult({ ok: true, campanha })
    },
  )

  // ---------------------------------------------------------------------
  // Produtos, indicadores e eventos
  // ---------------------------------------------------------------------

  registerAuditedTool(
    server,
    "listar_produtos",
    {
      title: "Listar produtos",
      description: "Lista o catálogo de produtos cadastrados para segmentação de leads e campanhas.",
      inputSchema: {},
    },
    async () => {
      const produtos = await listProdutos()
      return jsonResult({ ok: true, total: produtos.length, produtos })
    },
  )

  registerAuditedTool(
    server,
    "obter_indicadores",
    {
      title: "Obter indicadores do painel",
      description:
        "Retorna os KPIs principais do painel: leads ativos, campanhas ativas, mensagens hoje, taxa de resposta e taxa de qualificação (com variação em relação ao dia anterior).",
      inputSchema: {},
    },
    async () => jsonResult({ ok: true, indicadores: await getKpis() }),
  )

  registerAuditedTool(
    server,
    "listar_respostas_lead",
    {
      title: "Listar respostas recebidas",
      description:
        "Lista respostas recebidas dos leads, incluindo o perfil completo do lead, campanha, data e hora, e o conteúdo da resposta quando disponível. Pode filtrar por lead ou campanha.",
      inputSchema: {
        leadId: z.string().optional().describe("Filtra pelo ID do lead."),
        campanhaId: z.string().optional().describe("Filtra pelo ID da campanha."),
        limite: z.number().int().min(1).max(200).optional().describe("Máximo de respostas; padrão: 50."),
      },
    },
    async ({ leadId, campanhaId, limite }) => {
      const respostas = await listLeadResponses({ limit: limite ?? 50, leadId, campanhaId })
      return jsonResult({ ok: true, total: respostas.length, respostas })
    },
  )

  registerAuditedTool(
    server,
    "obter_envio",
    {
      title: "Obter envio",
      description:
        "Busca um envio de mensagem pelo ID do evento retornado na listagem de eventos, incluindo o texto integral enviado e os dados relacionados.",
      inputSchema: { id: z.string().describe("ID do evento do envio.") },
    },
    async ({ id }) => {
      const envio = await getEvent(id)
      if (!envio || envio.tipo !== "mensagem_enviada") return errorResult("Envio não encontrado.")
      return jsonResult({ ok: true, envio })
    },
  )

  server.registerTool(
    "listar_eventos_recentes",
    {
      title: "Listar eventos recentes",
      description: "Lista os eventos mais recentes da linha do tempo (mensagens enviadas, falhas, respostas, entradas/saídas de campanha).",
      inputSchema: { limite: z.number().int().min(1).max(200).optional().describe("Padrão: 50.") },
    },
    async ({ limite }) => {
      const eventos = await listEvents(limite ?? 50)
      return jsonResult({ ok: true, total: eventos.length, eventos })
    },
  )

  return server
}
