import { timingSafeEqual } from "node:crypto"

import { prisma, prismaGlobal } from "@/lib/prisma"
import {
  escolherOpcao,
  gatilhoDoTipo,
  modeloBotDepartamento,
  modeloBotTriagem,
  modeloFluxoResposta,
  opcoesDoMenu,
  NODE_CATALOG,
  OPERADORES_SEM_VALOR,
  PLUGINS_VERIFICAVEIS,
  STATUS_ALTERAVEIS_NO_FLUXO,
  validarGrafo,
  type FlowEdge,
  type FlowKind,
  type FlowNode,
} from "@/lib/nocode/catalog"
import { recordAppLog } from "@/services/app-logs"
import {
  entregarExecucao,
  podarExecucoesExpiradasComIntervalo,
  RETENCAO_EXECUCOES_SISTEMA_MS,
  type ConfigWebhookExecucoes,
} from "@/services/nocode-webhook-execucoes"
import { configurarWebhookEvolution, sendWhatsAppText } from "@/services/evolution"
import { processarRespostaLead, telefonesBatem } from "@/services/lead-response"
import { CrmError, transferirConversaPorBot, transferirParaAtendentePorBot } from "@/services/crm"
import { enviarLeadParaCampanha } from "@/services/lead-campanha"
import { setLeadStatus } from "@/services/leads"
import { LEAD_STATUS_LABEL, type LeadStatus } from "@/types"
import { mensagemPluginDesativado, type PluginKey } from "@/lib/plugins"
import { exigirPlugin, getPluginsAtivos } from "@/services/settings"

// ---------------------------------------------------------------------------
// Tipos e acesso aos dados
// ---------------------------------------------------------------------------

export interface FlowRow {
  id: string
  nome: string
  ativo: boolean
  /** Fluxo do sistema (“Fluxo de resposta”): sempre ativo, não pode ser desativado nem excluído. */
  sistema: boolean
  /** "automacao" (webhook da Evolution) ou "bot" (responde conversas do chat). */
  tipo: FlowKind
  /** Bot de entrada (triagem): atende quem ainda não está em nenhum departamento. */
  botEntrada: boolean
  /** Bot de departamento: o departamento que ele atende. */
  departamentoId: string | null
  departamentoNome: string | null
  /** Webhook que recebe cada execução. O segredo nunca sai do servidor: só se informa se existe. */
  webhookExecucoes: ConfigWebhookExecucoes
  nodes: FlowNode[]
  edges: FlowEdge[]
  criadoEm: string
  atualizadoEm: string
}

export interface PassoExecucao {
  nodeId: string
  nome: string
  tipo: string
  status: "ok" | "erro" | "simulado" | "ignorado"
  saida?: string
  resumo?: unknown
  erro?: string
  ms: number
}

export interface ExecutionRow {
  id: string
  flowId: string
  status: "sucesso" | "erro" | "ignorado"
  origem: "webhook" | "teste"
  entrada: unknown
  passos: PassoExecucao[]
  erro: string | null
  duracaoMs: number
  iniciadoEm: string
  /** Entrega ao webhook de execuções; `null` quando não se aplica (testes, webhook desligado). */
  webhook: {
    status: "pendente" | "enviando" | "enviado" | "falha"
    tentativas: number
    erro: string | null
    enviadoEm: string | null
  } | null
}

export const NOME_FLUXO_RESPOSTA = "Fluxo de resposta"
export const MSG_FLUXO_SISTEMA_DESATIVAR = "O fluxo de resposta é do sistema e precisa ficar sempre ativo."
export const MSG_FLUXO_SISTEMA_EXCLUIR = "O fluxo de resposta é do sistema e não pode ser excluído."

const MAX_EXECUCOES_POR_FLUXO = 200
const MAX_PASSOS = 100
const MAX_ESPERA_SEGUNDOS = 30

function paraFlow(row: {
  id: string
  nome: string
  ativo: boolean
  sistema: boolean
  tipo?: string
  botEntrada?: boolean
  departamentoId?: string | null
  departamento?: { nome: string } | null
  execWebhookAtivo?: boolean
  execWebhookUrl?: string | null
  execWebhookSegredo?: string | null
  nodes: unknown
  edges: unknown
  criadoEm: Date
  atualizadoEm: Date
}): FlowRow {
  return {
    id: row.id,
    nome: row.nome,
    ativo: row.ativo || row.sistema,
    sistema: row.sistema,
    tipo: row.tipo === "bot" ? "bot" : "automacao",
    botEntrada: row.botEntrada ?? false,
    departamentoId: row.departamentoId ?? null,
    departamentoNome: row.departamento?.nome ?? null,
    webhookExecucoes: {
      ativo: row.execWebhookAtivo ?? false,
      url: row.execWebhookUrl ?? "",
      temSegredo: Boolean(row.execWebhookSegredo),
    },
    nodes: Array.isArray(row.nodes) ? (row.nodes as FlowNode[]) : [],
    edges: Array.isArray(row.edges) ? (row.edges as FlowEdge[]) : [],
    criadoEm: row.criadoEm.toISOString(),
    atualizadoEm: row.atualizadoEm.toISOString(),
  }
}

function paraExecucao(row: {
  id: string
  flowId: string
  status: string
  origem: string
  entrada: unknown
  passos: unknown
  erro: string | null
  duracaoMs: number
  iniciadoEm: Date
  webhookStatus?: string | null
  webhookTentativas?: number
  webhookErro?: string | null
  webhookEnviadoEm?: Date | null
}): ExecutionRow {
  return {
    id: row.id,
    flowId: row.flowId,
    status: row.status as ExecutionRow["status"],
    origem: row.origem as ExecutionRow["origem"],
    entrada: row.entrada,
    passos: Array.isArray(row.passos) ? (row.passos as PassoExecucao[]) : [],
    erro: row.erro,
    duracaoMs: row.duracaoMs,
    iniciadoEm: row.iniciadoEm.toISOString(),
    webhook: row.webhookStatus
      ? {
          status: row.webhookStatus as NonNullable<ExecutionRow["webhook"]>["status"],
          tentativas: row.webhookTentativas ?? 0,
          erro: row.webhookErro ?? null,
          enviadoEm: row.webhookEnviadoEm ? row.webhookEnviadoEm.toISOString() : null,
        }
      : null,
  }
}

export async function listFlows(): Promise<FlowRow[]> {
  // O fluxo do sistema vem sempre primeiro; os demais, do mais recente para o mais antigo.
  const rows = await prisma.noCodeFlow.findMany({
    orderBy: [{ sistema: "desc" }, { atualizadoEm: "desc" }],
    include: { departamento: { select: { nome: true } } },
  })
  return rows.map(paraFlow)
}

/**
 * Garante que o fluxo de resposta do app exista e esteja ativo. É idempotente:
 * cria na primeira vez e, se alguém o tiver deixado inativo por fora (banco,
 * restauração de backup), volta a ativá-lo.
 */
export async function garantirFluxoResposta(): Promise<FlowRow> {
  const existente = await prisma.noCodeFlow.findFirst({ where: { sistema: true }, orderBy: { criadoEm: "asc" } })
  if (existente) {
    if (existente.ativo) return paraFlow(existente)
    return paraFlow(await prisma.noCodeFlow.update({ where: { id: existente.id }, data: { ativo: true } }))
  }

  try {
    const base = modeloFluxoResposta()
    const criado = await prisma.noCodeFlow.create({
      data: {
        nome: NOME_FLUXO_RESPOSTA,
        ativo: true,
        sistema: true,
        nodes: base.nodes as never,
        edges: base.edges as never,
      },
    })
    return paraFlow(criado)
  } catch (error) {
    // Outra requisição criou ao mesmo tempo (índice único parcial): usa o que ficou.
    const criado = await prisma.noCodeFlow.findFirst({ where: { sistema: true } })
    if (criado) return paraFlow(criado)
    throw error
  }
}

export async function getFlow(id: string): Promise<FlowRow | null> {
  const row = await prisma.noCodeFlow.findUnique({ where: { id }, include: { departamento: { select: { nome: true } } } })
  return row ? paraFlow(row) : null
}

export async function createFlow(input: {
  nome: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  tipo?: FlowKind
  botEntrada?: boolean
  departamentoId?: string | null
}): Promise<FlowRow> {
  const row = await prisma.noCodeFlow.create({
    data: {
      nome: input.nome,
      nodes: input.nodes as never,
      edges: input.edges as never,
      ...(input.tipo ? { tipo: input.tipo } : {}),
      ...(input.botEntrada ? { botEntrada: true } : {}),
      ...(input.departamentoId ? { departamentoId: input.departamentoId } : {}),
    },
  })
  return paraFlow(row)
}

/**
 * Cria um bot já com um modelo inicial: de entrada (triagem por menu) ou de um departamento.
 * Nasce desativado: o usuário edita no No Code e ativa quando estiver pronto.
 */
export async function createBot(input: { nome: string; departamentoId: string | null }): Promise<FlowRow> {
  const entrada = input.departamentoId === null
  const base = entrada ? modeloBotTriagem() : modeloBotDepartamento()
  return createFlow({
    nome: input.nome,
    ...base,
    tipo: "bot",
    botEntrada: entrada,
    departamentoId: input.departamentoId,
  })
}

/**
 * Só um bot ativo por escopo (o de entrada, ou um por departamento): ao ativar um, os outros do
 * mesmo escopo são desativados. Evita dois bots respondendo a mesma mensagem.
 */
export async function desativarBotsConcorrentes(bot: { id: string; botEntrada: boolean; departamentoId: string | null }): Promise<number> {
  if (!bot.botEntrada && !bot.departamentoId) return 0
  const resultado = await prisma.noCodeFlow.updateMany({
    where: {
      id: { not: bot.id },
      tipo: "bot",
      ativo: true,
      ...(bot.botEntrada ? { botEntrada: true } : { departamentoId: bot.departamentoId }),
    },
    data: { ativo: false },
  })
  return resultado.count
}

export async function updateFlow(
  id: string,
  input: { nome?: string; nodes?: FlowNode[]; edges?: FlowEdge[]; ativo?: boolean },
): Promise<FlowRow> {
  if (input.ativo === false) {
    const atual = await prisma.noCodeFlow.findUnique({ where: { id }, select: { sistema: true } })
    if (atual?.sistema) throw new Error(MSG_FLUXO_SISTEMA_DESATIVAR)
  }
  const row = await prisma.noCodeFlow.update({
    where: { id },
    data: {
      ...(input.nome !== undefined ? { nome: input.nome } : {}),
      ...(input.nodes !== undefined ? { nodes: input.nodes as never } : {}),
      ...(input.edges !== undefined ? { edges: input.edges as never } : {}),
      ...(input.ativo !== undefined ? { ativo: input.ativo } : {}),
    },
  })
  return paraFlow(row)
}

export async function deleteFlow(id: string): Promise<void> {
  // deleteMany com `sistema: false` nunca apaga o fluxo de resposta, nem por chamada direta.
  const apagados = await prisma.noCodeFlow.deleteMany({ where: { id, sistema: false } })
  if (apagados.count === 0 && (await prisma.noCodeFlow.findFirst({ where: { id, sistema: true }, select: { id: true } }))) {
    throw new Error(MSG_FLUXO_SISTEMA_EXCLUIR)
  }
}

/**
 * Quais execuções do fluxo aparecem: no fluxo do sistema, as das últimas 24h
 * (sem limite de quantidade); nos demais, todas as que foram guardadas.
 */
async function filtroExecucoesVisiveis(flowId: string) {
  const fluxo = await prisma.noCodeFlow.findUnique({ where: { id: flowId }, select: { sistema: true } })
  return fluxo?.sistema
    ? { flowId, iniciadoEm: { gte: new Date(Date.now() - RETENCAO_EXECUCOES_SISTEMA_MS) } }
    : { flowId }
}

/** Página de execuções, da mais nova para a mais antiga. `depoisDeId` continua de onde a página anterior parou. */
export async function listExecutions(
  flowId: string,
  opcoes: { limite?: number; depoisDeId?: string } = {},
): Promise<ExecutionRow[]> {
  const rows = await prisma.noCodeExecution.findMany({
    where: await filtroExecucoesVisiveis(flowId),
    orderBy: [{ iniciadoEm: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(opcoes.limite ?? 50, 1), 200),
    ...(opcoes.depoisDeId ? { cursor: { id: opcoes.depoisDeId }, skip: 1 } : {}),
  })
  return rows.map(paraExecucao)
}

export async function contarExecucoes(flowId: string): Promise<number> {
  return prisma.noCodeExecution.count({ where: await filtroExecucoesVisiveis(flowId) })
}

// ---------------------------------------------------------------------------
// Variáveis: {{caminho.pontilhado}}
// ---------------------------------------------------------------------------

type Contexto = Record<string, unknown>

/** Lê `a.b[0].c` de um objeto, sem lançar erro quando o caminho não existe. */
export function lerCaminho(origem: unknown, caminho: string): unknown {
  const partes = caminho
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean)
  let atual: unknown = origem
  for (const parte of partes) {
    if (atual === null || atual === undefined || typeof atual !== "object") return undefined
    atual = (atual as Record<string, unknown>)[parte]
  }
  return atual
}

function textoDe(valor: unknown): string {
  if (valor === null || valor === undefined) return ""
  if (typeof valor === "object") return JSON.stringify(valor)
  return String(valor)
}

/** Troca `{{variavel}}` pelo valor no contexto. */
export function renderizar(modelo: string, ctx: Contexto): string {
  return modelo.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, caminho: string) => textoDe(lerCaminho(ctx, caminho)))
}

/** Resolve um campo que pode vir como `caminho` ou `{{caminho}}` para o valor real (sem virar texto). */
function resolverCampo(campo: string, ctx: Contexto): unknown {
  const limpo = campo.trim()
  const unico = limpo.match(/^\{\{\s*([^}]+?)\s*\}\}$/)
  if (unico) return lerCaminho(ctx, unico[1])
  if (limpo.includes("{{")) return renderizar(limpo, ctx)
  return lerCaminho(ctx, limpo)
}

function avaliarCondicao(valorCampo: unknown, operador: string, esperadoBruto: string): boolean {
  const texto = textoDe(valorCampo)
  const esperado = esperadoBruto
  switch (operador) {
    case "igual":
      return texto === esperado
    case "diferente":
      return texto !== esperado
    case "contem":
      return texto.toLowerCase().includes(esperado.toLowerCase())
    case "nao_contem":
      return !texto.toLowerCase().includes(esperado.toLowerCase())
    case "comeca_com":
      return texto.toLowerCase().startsWith(esperado.toLowerCase())
    case "existe":
      return valorCampo !== undefined && valorCampo !== null && texto !== ""
    case "nao_existe":
      return valorCampo === undefined || valorCampo === null || texto === ""
    case "verdadeiro":
      return valorCampo === true || texto === "true"
    case "falso":
      return valorCampo === false || texto === "false"
    case "maior":
      return Number(valorCampo) > Number(esperado)
    case "menor":
      return Number(valorCampo) < Number(esperado)
    default:
      throw new Error(`Operador desconhecido: ${operador}`)
  }
}

// ---------------------------------------------------------------------------
// Execução dos blocos
// ---------------------------------------------------------------------------

interface ResultadoBloco {
  saida: string
  vars?: Contexto
  resumo?: unknown
  status?: PassoExecucao["status"]
  /** Encerra o fluxo marcando-o como ignorado. */
  fim?: "ignorado"
  /** O bloco enviou uma pergunta e o fluxo PARA aqui até o lead responder (só em bots). */
  espera?: boolean
}

/** Conversa em que um bot está rodando; fica em `ctx.bot` (nunca aparece nas variáveis do editor). */
export interface ContextoBot {
  leadId: string
  flowNome: string
}
const botDe = (ctx: Contexto): ContextoBot | null => (ctx.bot as ContextoBot | undefined) ?? null

/** Grava no chat a mensagem que o bot enviou, para a equipe vê-la na conversa. */
async function registrarMensagemBot(bot: ContextoBot, texto: string): Promise<void> {
  await prisma.timelineEvent.create({
    data: {
      leadId: bot.leadId,
      campanhaId: null,
      mensagemId: null,
      tipo: "mensagem_enviada",
      descricao: `Resposta automática do bot “${bot.flowNome}”.`,
      detalhes: `Mensagem: "${texto}"`,
      sucesso: true,
    },
  })
}

/** Texto do menu: a mensagem seguida das opções numeradas (e do aviso, se a resposta anterior foi inválida). */
export function montarTextoMenu(mensagem: string, opcoes: string[], aviso = ""): string {
  const lista = opcoes.map((opcao, i) => `${i + 1} - ${opcao}`).join("\n")
  return [aviso.trim(), mensagem.trim(), lista].filter(Boolean).join("\n\n")
}

const digitos = (v: unknown) => textoDe(v).replace(/\D/g, "")
const pausa = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function executarBloco(no: FlowNode, ctx: Contexto, simulacao: boolean): Promise<ResultadoBloco> {
  const cfg = no.config
  const texto = (chave: string) => String(cfg[chave] ?? "")

  switch (no.type) {
    case "webhook":
      return { saida: "main", resumo: "Evento recebido." }

    case "extrair_telefone": {
      const origem = resolverCampo(texto("campo") || "webhook.data.key.remoteJid", ctx)
      const bruto = textoDe(origem).split("@")[0].split(":")[0]
      let telefone = digitos(bruto)
      if (!telefone) throw new Error(`Nenhum telefone encontrado em "${texto("campo")}".`)
      if (cfg.adicionar9 === true && telefone.startsWith("55") && telefone.length === 12) {
        telefone = `${telefone.slice(0, 4)}9${telefone.slice(4)}`
      }
      return { saida: "main", vars: { telefone }, resumo: { telefone } }
    }

    case "condicao": {
      const operador = texto("operador") || "igual"
      const valorCampo = resolverCampo(texto("campo"), ctx)
      const esperado = OPERADORES_SEM_VALOR.includes(operador) ? "" : renderizar(texto("valor"), ctx)
      const resultado = avaliarCondicao(valorCampo, operador, esperado)
      return { saida: resultado ? "true" : "false", resumo: { valor: valorCampo ?? null, resultado } }
    }

    case "plugin_ativo": {
      const plugin = String(cfg.plugin ?? "") as PluginKey
      if (!PLUGINS_VERIFICAVEIS.includes(plugin)) throw new Error("Escolha o plugin a verificar.")
      const ativo = (await getPluginsAtivos())[plugin]
      return { saida: ativo ? "true" : "false", vars: { plugin: { nome: plugin, ativo } }, resumo: { plugin, ativo } }
    }

    case "buscar_lead": {
      const telefone = digitos(renderizar(texto("telefone") || "{{telefone}}", ctx))
      if (!telefone) throw new Error("Telefone vazio para buscar o lead.")
      const candidatos = await prisma.lead.findMany({
        where: { telefone: { contains: telefone.slice(-8) } },
        select: {
          id: true,
          nome: true,
          telefone: true,
          status: true,
          campanhaId: true,
          campanhas: { select: { campanhaId: true } },
        },
      })
      const lead = candidatos.find((c) => telefonesBatem(c.telefone, telefone)) ?? null
      const campanhasIds = lead
        ? [...new Set([...(lead.campanhaId ? [lead.campanhaId] : []), ...lead.campanhas.map((c) => c.campanhaId)])]
        : []
      const saida = {
        encontrado: Boolean(lead),
        id: lead?.id ?? null,
        nome: lead?.nome ?? null,
        status: lead?.status ?? null,
        campanhasIds,
        temCampanha: campanhasIds.length > 0,
      }
      return { saida: "main", vars: { lead: saida }, resumo: saida }
    }

    case "registrar_resposta": {
      if (simulacao) return { saida: "main", status: "simulado", resumo: "Teste: a resposta não foi gravada." }
      const resultado = await processarRespostaLead(ctx.webhook)
      return {
        saida: "main",
        vars: { resposta: resultado },
        status: resultado.ok ? "ok" : "ignorado",
        resumo: resultado,
      }
    }

    case "enviar_mensagem": {
      const telefone = renderizar(texto("telefone") || "{{telefone}}", ctx)
      const mensagem = renderizar(texto("texto"), ctx).trim()
      if (!mensagem) throw new Error("A mensagem está vazia.")
      if (simulacao) return { saida: "main", status: "simulado", resumo: { telefone, texto: mensagem } }
      const envio = await sendWhatsAppText({ telefone, texto: mensagem })
      if (!envio.ok) throw new Error(envio.erro ?? "Falha ao enviar a mensagem.")
      const bot = botDe(ctx)
      if (bot) await registrarMensagemBot(bot, mensagem)
      return { saida: "main", vars: { envio: { ok: true } }, resumo: { telefone } }
    }

    case "aguardar": {
      const segundos = Math.min(Math.max(Number(cfg.segundos) || 0, 0), MAX_ESPERA_SEGUNDOS)
      if (!simulacao) await pausa(segundos * 1000)
      return { saida: "main", resumo: { segundos } }
    }

    case "ignorar":
      return { saida: "main", fim: "ignorado", status: "ignorado", resumo: "Fluxo encerrado." }

    case "mensagem_recebida":
      return { saida: "main", resumo: { mensagem: textoDe(ctx.mensagem) } }

    case "menu": {
      const opcoes = opcoesDoMenu(cfg)
      const aviso = ctx.botInvalido === true ? renderizar(texto("textoInvalido"), ctx) : ""
      const corpo = montarTextoMenu(renderizar(texto("texto"), ctx), opcoes, aviso)
      if (simulacao) {
        // No teste não há lead para responder: a "mensagem" do evento de teste faz o papel da escolha.
        const indice = escolherOpcao(textoDe(ctx.mensagem), opcoes)
        return {
          saida: indice >= 0 ? `op_${indice + 1}` : "outra",
          status: "simulado",
          resumo: { texto: corpo, mensagemDoTeste: textoDe(ctx.mensagem), opcaoEscolhida: indice >= 0 ? opcoes[indice] : null },
        }
      }
      const bot = botDe(ctx)
      const telefone = textoDe(ctx.telefone)
      if (!bot || !telefone) throw new Error("O menu só funciona dentro de um bot (numa conversa com um lead).")
      const envio = await sendWhatsAppText({ telefone, texto: corpo })
      if (!envio.ok) throw new Error(envio.erro ?? "Falha ao enviar o menu.")
      await registrarMensagemBot(bot, corpo)
      return { saida: "", espera: true, resumo: { aguardando: "Resposta do lead ao menu", opcoes } }
    }

    case "transferir_atendente": {
      const modo = cfg.modo === "especifico" ? "especifico" : "balanceado"
      const atendenteId = String(cfg.atendenteId ?? "").trim()
      const departamento = renderizar(texto("departamento"), ctx).trim()
      if (modo === "especifico" && !atendenteId) throw new Error("Escolha o atendente da transferência.")
      if (simulacao) return { saida: "main", status: "simulado", resumo: { modo, atendenteId: atendenteId || null, departamento: departamento || null } }
      // Os blocos de transferência são do CRM: com o plugin desativado eles não executam.
      await exigirPlugin("crm")
      const bot = botDe(ctx)
      if (!bot) throw new Error("A transferência só funciona dentro de um bot (numa conversa com um lead).")
      const resultado = await transferirParaAtendentePorBot(bot.leadId, { modo, atendenteId, departamento, nomeBot: bot.flowNome })
      if (!resultado.ok) return { saida: "sem_atendente", resumo: { motivo: resultado.motivo } }
      return {
        saida: "main",
        vars: { atendente: resultado.atendente, ...(resultado.departamento ? { departamento: { nome: resultado.departamento } } : {}) },
        resumo: { atendente: resultado.atendente.nome },
      }
    }

    case "enviar_lead_campanha": {
      const campanhaId = String(cfg.campanhaId ?? "").trim()
      if (!campanhaId) throw new Error("Escolha a campanha do envio.")
      const leadId = String(resolverCampo(texto("leadId") || "{{lead.id}}", ctx) ?? "").trim()
      const mensagemIndividual = renderizar(texto("mensagemIndividual"), ctx).trim()
      if (simulacao) {
        return { saida: "main", status: "simulado", resumo: { leadId: leadId || null, campanhaId, mensagemIndividual: mensagemIndividual || null } }
      }
      if (!leadId) return { saida: "nao_enviado", resumo: { motivo: "Nenhum lead para enviar (lead não encontrado)." } }
      const bot = botDe(ctx)
      try {
        const r = await enviarLeadParaCampanha({
          leadId,
          campanhaId,
          mensagemIndividual,
          autor: bot ? `o bot “${bot.flowNome}”` : "um fluxo No Code",
        })
        return {
          saida: "main",
          vars: { campanha: { id: campanhaId, nome: r.campanhaNome, status: r.campanhaStatus } },
          resumo: { lead: r.leadNome, campanha: r.campanhaNome, aguardaAtivacao: r.aguardaAtivacao },
        }
      } catch (error) {
        // Regra de negócio (já está na campanha, encerrada…): o fluxo decide o que fazer pela saída.
        if (error instanceof CrmError) return { saida: "nao_enviado", resumo: { motivo: error.message } }
        throw error
      }
    }

    case "alterar_status_lead": {
      const status = String(cfg.status ?? "").trim() as LeadStatus
      if (!STATUS_ALTERAVEIS_NO_FLUXO.includes(status)) throw new Error("Escolha o novo status do lead.")
      const leadId = String(resolverCampo(texto("leadId") || "{{lead.id}}", ctx) ?? "").trim()
      if (simulacao) return { saida: "main", status: "simulado", resumo: { leadId: leadId || null, status } }
      if (!leadId) return { saida: "nao_alterado", resumo: { motivo: "Nenhum lead para alterar (lead não encontrado)." } }

      const atual = await prisma.lead.findUnique({ where: { id: leadId }, select: { nome: true, status: true } })
      if (!atual) return { saida: "nao_alterado", resumo: { motivo: "Lead não encontrado." } }

      const vars = { status_lead: { anterior: atual.status, atual: status } }
      // Já está no status pedido: o objetivo do bloco está cumprido, então segue por “Alterado”.
      if (atual.status === status) {
        return { saida: "main", vars, resumo: { lead: atual.nome, status, jaEstava: true } }
      }

      // `setLeadStatus` é a mesma rotina da tabela de leads, do kanban e da API: com “Não contatar”
      // (ou “Respondeu”) o lead sai de todas as campanhas, e o webhook de status é emitido.
      const lead = await setLeadStatus(leadId, status)
      if (!lead) return { saida: "nao_alterado", resumo: { motivo: "Lead não encontrado." } }

      // A equipe vê no chat que o status mudou (e por quem). Nunca derruba a execução.
      const bot = botDe(ctx)
      const autor = bot ? `o bot “${bot.flowNome}”` : "um fluxo No Code"
      try {
        await prisma.chatInternalNote.create({
          data: {
            leadId,
            texto: `Status do lead alterado de “${LEAD_STATUS_LABEL[atual.status]}” para “${LEAD_STATUS_LABEL[status]}” por ${autor}.`,
          },
        })
      } catch (error) {
        console.error("[nocode] falha ao registrar a nota interna da troca de status", error)
      }
      return { saida: "main", vars, resumo: { lead: atual.nome, de: atual.status, para: status } }
    }

    case "transferir_departamento": {
      const departamento = renderizar(texto("departamento"), ctx).trim()
      if (!departamento) throw new Error("Informe o departamento da transferência.")
      const pausarBot = cfg.pausarBot === true
      if (simulacao) return { saida: "main", status: "simulado", resumo: { departamento, pausarBot } }
      await exigirPlugin("crm")
      const bot = botDe(ctx)
      if (!bot) throw new Error("A transferência só funciona dentro de um bot (numa conversa com um lead).")
      const resultado = await transferirConversaPorBot(bot.leadId, departamento, { pausarBot, nomeBot: bot.flowNome })
      return { saida: "main", vars: { departamento: { nome: resultado.departamento } }, resumo: resultado }
    }

    default:
      throw new Error(`Bloco desconhecido: ${String(no.type)}.`)
  }
}

export interface ResultadoExecucao {
  status: ExecutionRow["status"]
  passos: PassoExecucao[]
  erro: string | null
  duracaoMs: number
  /** Bot parado num menu, esperando o lead responder (a conversa guarda este bloco). */
  espera?: { nodeId: string }
}

export interface OpcoesExecucao {
  kind?: FlowKind
  /** Continua a partir destes blocos em vez de começar no gatilho (retomada de um menu). */
  filaInicial?: string[]
  /** Variáveis já conhecidas ao começar (num bot: mensagem, telefone, lead, bot…). */
  ctxInicial?: Contexto
}

/**
 * Percorre o grafo a partir do gatilho, bloco a bloco, seguindo a saída
 * escolhida por cada um. Para no primeiro erro. Em `simulacao`, blocos com
 * efeito colateral (registrar resposta, enviar mensagem) não executam.
 */
export async function executarFluxo(
  fluxo: { nodes: FlowNode[]; edges: FlowEdge[] },
  entrada: unknown,
  simulacao = false,
  opcoes: OpcoesExecucao = {},
): Promise<ResultadoExecucao> {
  const inicio = Date.now()
  const passos: PassoExecucao[] = []
  const tipoGatilho = gatilhoDoTipo(opcoes.kind ?? "automacao")
  const gatilho = opcoes.filaInicial ? null : fluxo.nodes.find((n) => n.type === tipoGatilho)
  if (!opcoes.filaInicial && !gatilho) {
    return {
      status: "erro",
      passos,
      erro: `O fluxo não tem um bloco ${NODE_CATALOG[tipoGatilho].label} (gatilho).`,
      duracaoMs: 0,
    }
  }

  let ctx: Contexto = { webhook: entrada, ...(opcoes.ctxInicial ?? {}) }
  let ignorado = false
  let erro: string | null = null
  let espera: { nodeId: string } | undefined
  const fila: string[] = opcoes.filaInicial ? [...opcoes.filaInicial] : [gatilho!.id]

  while (fila.length > 0 && passos.length < MAX_PASSOS) {
    const idAtual = fila.shift()
    const no = fluxo.nodes.find((n) => n.id === idAtual)
    if (!no) continue

    const t0 = Date.now()
    try {
      const resultado = await executarBloco(no, ctx, simulacao)
      if (resultado.vars) ctx = { ...ctx, ...resultado.vars }
      passos.push({
        nodeId: no.id,
        nome: no.name,
        tipo: no.type,
        status: resultado.status ?? "ok",
        saida: resultado.saida,
        resumo: resultado.resumo,
        ms: Date.now() - t0,
      })
      if (resultado.fim === "ignorado") ignorado = true
      if (resultado.status === "ignorado" && no.type === "registrar_resposta") ignorado = true
      if (resultado.fim) continue
      if (resultado.espera) {
        // O bot perguntou e agora é a vez do lead: este ramo para aqui.
        espera = { nodeId: no.id }
        continue
      }
      for (const aresta of fluxo.edges) {
        if (aresta.source === no.id && aresta.sourceHandle === resultado.saida) fila.push(aresta.target)
      }
    } catch (error) {
      erro = error instanceof Error ? error.message : String(error)
      passos.push({ nodeId: no.id, nome: no.name, tipo: no.type, status: "erro", erro, ms: Date.now() - t0 })
      break
    }
  }

  if (!erro && passos.length >= MAX_PASSOS) erro = "Limite de passos atingido (possível laço no fluxo)."

  return {
    status: erro ? "erro" : ignorado ? "ignorado" : "sucesso",
    passos,
    erro,
    duracaoMs: Date.now() - inicio,
    ...(espera && !erro ? { espera } : {}),
  }
}

/** Variáveis do evento de teste de um bot: a "mensagem" do JSON faz o papel da resposta do lead. */
function contextoBotDeTeste(entrada: unknown): Contexto {
  const mensagem = textoDe(lerCaminho(entrada, "mensagem"))
  return {
    mensagem,
    telefone: "5579999999999",
    lead: { encontrado: true, id: "teste", nome: "Contato de teste", status: "novo", temCampanha: false, campanhasIds: [] },
    departamento: null,
  }
}

/** Executa e grava no histórico (mantém só as últimas execuções do fluxo). */
export async function executarEGravar(
  flowId: string,
  fluxo: { nodes: FlowNode[]; edges: FlowEdge[] },
  entrada: unknown,
  origem: "webhook" | "teste",
  kind: FlowKind = "automacao",
): Promise<ExecutionRow> {
  const simulacao = origem === "teste"
  const resultado = await executarFluxo(fluxo, entrada, simulacao, {
    kind,
    ctxInicial: kind === "bot" && simulacao ? contextoBotDeTeste(entrada) : undefined,
  })
  return gravarExecucao(flowId, entrada, origem, resultado)
}

/** Grava no histórico uma execução já feita (e entrega ao webhook de execuções, se houver). */
export async function gravarExecucao(
  flowId: string,
  entrada: unknown,
  origem: "webhook" | "teste",
  resultado: ResultadoExecucao,
): Promise<ExecutionRow> {
  const config = await prisma.noCodeFlow.findUnique({
    where: { id: flowId },
    select: { sistema: true, execWebhookAtivo: true, execWebhookUrl: true },
  })
  // Só execuções reais vão para o webhook; testes feitos na tela ficam só no app.
  // O webhook de execuções é do plugin No Code: desativado, nada é entregue.
  const nocodeAtivo = (await getPluginsAtivos()).nocode
  const enviarAoWebhook = origem === "webhook" && nocodeAtivo && Boolean(config?.execWebhookAtivo && config.execWebhookUrl)

  const gravada = await prisma.noCodeExecution.create({
    data: {
      flowId,
      status: resultado.status,
      origem,
      entrada: (entrada ?? null) as never,
      passos: resultado.passos as never,
      erro: resultado.erro,
      duracaoMs: resultado.duracaoMs,
      webhookStatus: enviarAoWebhook ? "pendente" : null,
    },
  })

  if (resultado.status === "erro") {
    await recordAppLog({
      nivel: "erro",
      origem: "nocode",
      mensagem: `Fluxo No Code com erro (${origem}).`,
      detalhes: resultado.erro,
    })
  }

  // Fluxo do sistema: guarda 24h, sem limite de quantidade. Os demais mantêm só as últimas.
  if (config?.sistema) {
    await podarExecucoesExpiradasComIntervalo().catch(() => undefined)
  } else {
    const antigos = await prisma.noCodeExecution.findMany({
      where: { flowId },
      orderBy: { iniciadoEm: "desc" },
      skip: MAX_EXECUCOES_POR_FLUXO,
      select: { id: true },
    })
    if (antigos.length > 0) {
      await prisma.noCodeExecution.deleteMany({ where: { id: { in: antigos.map((a) => a.id) } } })
    }
  }

  // Envia já; se falhar, a rotina periódica repete até dar certo (ou a execução expirar).
  if (enviarAoWebhook) await entregarExecucao(gravada.id)

  return paraExecucao(gravada)
}

// ---------------------------------------------------------------------------
// Entrada pelo webhook da Evolution
// ---------------------------------------------------------------------------

function tokensIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** `MESSAGES_UPSERT`, `messages.upsert` e `messages-upsert` contam como o mesmo evento. */
function normalizarEvento(evento: unknown): string {
  return textoDe(evento).trim().toLowerCase().replace(/[_-]/g, ".")
}

export type PreparoWebhook =
  | { ok: true; fluxo: FlowRow }
  | { ok: false; status: 401 | 404 | 202; erro: string }

/**
 * Instância dona de um fluxo. A rota do webhook é pública (a Evolution não tem sessão): o id do
 * fluxo diz de qual instância é o evento. Instância suspensa = como se o fluxo não existisse.
 */
export async function workspaceDoFluxo(flowId: string): Promise<string | null> {
  const fluxo = await prismaGlobal.noCodeFlow.findUnique({ where: { id: flowId }, select: { workspaceId: true } })
  if (!fluxo) return null
  const ws = await prismaGlobal.workspace.findUnique({ where: { id: fluxo.workspaceId }, select: { ativo: true } })
  return ws?.ativo ? fluxo.workspaceId : null
}

/** Valida fluxo + token antes de aceitar o evento (a execução em si roda depois da resposta). */
export async function prepararWebhook(flowId: string, token: string | null): Promise<PreparoWebhook> {
  const fluxo = await getFlow(flowId)
  if (!fluxo || fluxo.tipo === "bot") return { ok: false, status: 404, erro: "Fluxo não encontrado." }

  const gatilho = fluxo.nodes.find((n) => n.type === "webhook")
  const esperado = String(gatilho?.config.token ?? "")
  if (!esperado || !token || !tokensIguais(token, esperado)) {
    return { ok: false, status: 401, erro: "Token inválido." }
  }
  // 202: aceito mas sem processar, para a Evolution não ficar reenviando.
  if (!fluxo.ativo && !fluxo.sistema) return { ok: false, status: 202, erro: "Fluxo desativado." }
  // Sem o plugin No Code, nenhum fluxo do usuário roda. Só o fluxo de resposta do sistema segue
  // (ele registra as respostas dos leads, função central do app) — e só com o modelo padrão.
  if (!fluxo.sistema && !(await getPluginsAtivos()).nocode) {
    return { ok: false, status: 202, erro: mensagemPluginDesativado("nocode") }
  }
  const erroGrafo = validarGrafo(fluxo.nodes, fluxo.edges, true)
  if (erroGrafo) return { ok: false, status: 202, erro: erroGrafo }
  return { ok: true, fluxo }
}

/** Roda o fluxo para um evento recebido. Eventos fora do filtro do gatilho são descartados sem registro. */
export async function processarEventoWebhook(fluxo: FlowRow, payload: unknown): Promise<void> {
  try {
    const gatilho = fluxo.nodes.find((n) => n.type === "webhook")
    const aceito = normalizarEvento(gatilho?.config.evento)
    const recebido = normalizarEvento(lerCaminho(payload, "event"))
    if (aceito && recebido && aceito !== recebido) return

    // No Code desativado: o fluxo de resposta roda só o modelo padrão do sistema; blocos que o
    // usuário acrescentou no editor (enviar mensagem, condições próprias…) ficam parados.
    const nocodeAtivo = (await getPluginsAtivos()).nocode
    const grafo = nocodeAtivo ? fluxo : { ...fluxo, ...modeloFluxoResposta() }
    await executarEGravar(fluxo.id, grafo, payload, "webhook")
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "nocode",
      mensagem: "Falha ao processar evento no fluxo No Code.",
      detalhes: error,
    })
  }
}


// ---------------------------------------------------------------------------
// Webhook automático nas instâncias da Evolution
// ---------------------------------------------------------------------------

/** Endereços que a Evolution (fora da máquina do app) não consegue alcançar. */
export function enderecoInacessivel(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host.endsWith(".local") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    )
  } catch {
    return true
  }
}

/** Link do webhook do fluxo de resposta do app (ou, na falta, do fluxo ativo mais recente com gatilho Webhook e token). */
export async function urlWebhookDoFluxoAtivo(origem: string): Promise<{ url: string; fluxo: string } | null> {
  // Garante o fluxo de resposta do app (ele é o preferido: o mais recente fica só como reserva).
  await garantirFluxoResposta()
  const ativos = await prisma.noCodeFlow.findMany({
    where: { tipo: "automacao", OR: [{ ativo: true }, { sistema: true }] },
    orderBy: [{ sistema: "desc" }, { atualizadoEm: "desc" }],
  })
  for (const linha of ativos) {
    const fluxo = paraFlow(linha)
    const gatilho = fluxo.nodes.find((n) => n.type === "webhook")
    const token = String(gatilho?.config.token ?? "")
    if (gatilho && token) {
      return { url: `${origem.replace(/\/$/, "")}/api/nocode/webhook/${fluxo.id}?token=${encodeURIComponent(token)}`, fluxo: fluxo.nome }
    }
  }
  return null
}

export interface ResultadoWebhookInstancia {
  ok: boolean
  /** true quando nada foi tentado (plugin desligado, sem fluxo ativo…): não é falha. */
  ignorado?: boolean
  message: string
}

/**
 * Aponta o webhook da instância (evento MESSAGES_UPSERT) para o fluxo de
 * resposta do app. Nunca lança: o resultado diz o que aconteceu, para quem chama avisar.
 */
export async function configurarWebhookDaInstancia(instancia: string, origem: string | null): Promise<ResultadoWebhookInstancia> {
  try {
    // O fluxo de resposta é do sistema (sempre ativo): o webhook não depende do plugin estar ligado.
    if (!origem) {
      return { ok: false, message: "Não foi possível descobrir o endereço público do app. Defina APP_PUBLIC_URL." }
    }
    if (enderecoInacessivel(origem)) {
      return {
        ok: false,
        message: `O endereço do app (${origem}) não é acessível pela Evolution. Defina APP_PUBLIC_URL com o endereço público.`,
      }
    }
    const alvo = await urlWebhookDoFluxoAtivo(origem)
    if (!alvo) {
      return {
        ok: false,
        ignorado: true,
        message: "Nenhum fluxo No Code ativo com gatilho Webhook: webhook não configurado.",
      }
    }
    let resultado = await configurarWebhookEvolution(instancia, alvo.url)
    if (!resultado.ok) {
      // Logo após criar, a Evolution pode ainda não estar pronta para aceitar o webhook: tenta mais uma vez.
      await pausa(2000)
      resultado = await configurarWebhookEvolution(instancia, alvo.url)
    }
    if (!resultado.ok) {
      return { ok: false, message: `Não foi possível configurar o webhook na Evolution: ${resultado.erro ?? "erro desconhecido"}` }
    }
    return { ok: true, message: `Webhook ativado na Evolution (evento MESSAGES_UPSERT → fluxo “${alvo.fluxo}”).` }
  } catch (error) {
    await recordAppLog({ origem: "nocode", mensagem: `Falha ao configurar o webhook da instância "${instancia}".`, detalhes: error })
    return { ok: false, message: "Erro inesperado ao configurar o webhook da instância." }
  }
}
