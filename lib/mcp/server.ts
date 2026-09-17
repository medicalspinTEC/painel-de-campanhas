import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { validarTelefoneBR } from "@/lib/telefone"
import { listProdutos } from "@/services/produtos"
import { getKpis } from "@/services/analytics"
import { listEvents } from "@/services/events"
import {
  createLead,
  getLead,
  LeadValidationError,
  listLeads,
  sendLeadMessage,
  setLeadStatus,
  updateLeadNotes,
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

export function createAppMcpServer(): McpServer {
  const server = new McpServer({
    name: "engine-followup",
    version: "1.0.0",
    title: "Painel de Campanhas (Engine Follow-up)",
  })

  // ---------------------------------------------------------------------
  // Leads
  // ---------------------------------------------------------------------

  server.registerTool(
    "listar_leads",
    {
      title: "Listar leads",
      description:
        "Lista todos os leads cadastrados, com agregações de mensagens e respostas. Aceita filtro opcional por status e por um termo de busca (nome ou telefone).",
      inputSchema: {
        status: z
          .enum(STATUS_LEAD_VALORES)
          .optional()
          .describe("Filtra pelo status do lead."),
        busca: z.string().optional().describe("Filtra por nome ou telefone contendo este texto."),
      },
    },
    async ({ status, busca }) => {
      let leads = await listLeads()
      if (status) leads = leads.filter((lead) => lead.status === status)
      if (busca?.trim()) {
        const termo = busca.trim().toLowerCase()
        leads = leads.filter(
          (lead) => lead.nome.toLowerCase().includes(termo) || lead.telefone.includes(termo),
        )
      }
      return jsonResult({ ok: true, total: leads.length, leads })
    },
  )

  server.registerTool(
    "obter_lead",
    {
      title: "Obter lead",
      description: "Busca um lead específico pelo ID, incluindo sua linha do tempo de eventos.",
      inputSchema: { id: z.string().describe("ID do lead.") },
    },
    async ({ id }) => {
      const lead = await getLead(id)
      if (!lead) return errorResult("Lead não encontrado.")
      return jsonResult({ ok: true, lead })
    },
  )

  server.registerTool(
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
        return jsonResult({ ok: true, lead })
      } catch (error) {
        if (error instanceof LeadValidationError) {
          return errorResult("Corrija os campos destacados.", { errors: error.errors })
        }
        throw error
      }
    },
  )

  server.registerTool(
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
      return jsonResult({ ok: true, lead })
    },
  )

  server.registerTool(
    "anotar_lead",
    {
      title: "Anotar lead",
      description: "Substitui as anotações internas de um lead pelo texto informado.",
      inputSchema: { id: z.string(), notas: z.string() },
    },
    async ({ id, notas }) => {
      const lead = await updateLeadNotes(id, notas)
      if (!lead) return errorResult("Lead não encontrado.")
      return jsonResult({ ok: true, lead })
    },
  )

  server.registerTool(
    "enviar_mensagem_lead",
    {
      title: "Enviar mensagem avulsa a um lead",
      description:
        "Envia (via WhatsApp/Evolution) uma mensagem avulsa a um lead específico, fora da sequência de qualquer campanha. Aceita as mesmas variáveis do editor de campanhas (ex.: {{primeiro_nome}}).",
      inputSchema: {
        leadId: z.string(),
        texto: z.string().min(1),
        instanciaNome: z.string().optional().describe("Instância da Evolution a usar; padrão do ambiente se omitido."),
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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
        instanciaNome: z.string().optional().describe("Instância da Evolution; padrão do ambiente se omitido."),
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    "obter_indicadores",
    {
      title: "Obter indicadores do painel",
      description:
        "Retorna os KPIs principais do painel: leads ativos, campanhas ativas, mensagens hoje, taxa de resposta e taxa de qualificação (com variação em relação ao dia anterior).",
      inputSchema: {},
    },
    async () => jsonResult({ ok: true, indicadores: await getKpis() }),
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
