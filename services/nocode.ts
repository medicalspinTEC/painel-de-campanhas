import { timingSafeEqual } from "node:crypto"

import { prisma } from "@/lib/prisma"
import {
  modeloFluxoResposta,
  NODE_CATALOG,
  OPERADORES_SEM_VALOR,
  validarGrafo,
  type FlowEdge,
  type FlowNode,
} from "@/lib/nocode/catalog"
import { recordAppLog } from "@/services/app-logs"
import { configurarWebhookEvolution, sendWhatsAppText } from "@/services/evolution"
import { processarRespostaLead, telefonesBatem } from "@/services/lead-response"

// ---------------------------------------------------------------------------
// Tipos e acesso aos dados
// ---------------------------------------------------------------------------

export interface FlowRow {
  id: string
  nome: string
  ativo: boolean
  /** Fluxo do sistema (“Fluxo de resposta”): sempre ativo, não pode ser desativado nem excluído. */
  sistema: boolean
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
  }
}

export async function listFlows(): Promise<FlowRow[]> {
  // O fluxo do sistema vem sempre primeiro; os demais, do mais recente para o mais antigo.
  const rows = await prisma.noCodeFlow.findMany({ orderBy: [{ sistema: "desc" }, { atualizadoEm: "desc" }] })
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
  const row = await prisma.noCodeFlow.findUnique({ where: { id } })
  return row ? paraFlow(row) : null
}

export async function createFlow(input: { nome: string; nodes: FlowNode[]; edges: FlowEdge[] }): Promise<FlowRow> {
  const row = await prisma.noCodeFlow.create({
    data: { nome: input.nome, nodes: input.nodes as never, edges: input.edges as never },
  })
  return paraFlow(row)
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

export async function listExecutions(flowId: string, limit = 30): Promise<ExecutionRow[]> {
  const rows = await prisma.noCodeExecution.findMany({
    where: { flowId },
    orderBy: { iniciadoEm: "desc" },
    take: limit,
  })
  return rows.map(paraExecucao)
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
      return { saida: "main", vars: { envio: { ok: true } }, resumo: { telefone } }
    }

    case "aguardar": {
      const segundos = Math.min(Math.max(Number(cfg.segundos) || 0, 0), MAX_ESPERA_SEGUNDOS)
      if (!simulacao) await pausa(segundos * 1000)
      return { saida: "main", resumo: { segundos } }
    }

    case "ignorar":
      return { saida: "main", fim: "ignorado", status: "ignorado", resumo: "Fluxo encerrado." }

    default:
      throw new Error(`Bloco desconhecido: ${String(no.type)}.`)
  }
}

export interface ResultadoExecucao {
  status: ExecutionRow["status"]
  passos: PassoExecucao[]
  erro: string | null
  duracaoMs: number
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
): Promise<ResultadoExecucao> {
  const inicio = Date.now()
  const passos: PassoExecucao[] = []
  const gatilho = fluxo.nodes.find((n) => n.type === "webhook")
  if (!gatilho) {
    return { status: "erro", passos, erro: "O fluxo não tem um bloco Webhook (gatilho).", duracaoMs: 0 }
  }

  let ctx: Contexto = { webhook: entrada }
  let ignorado = false
  let erro: string | null = null
  const fila: string[] = [gatilho.id]

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
  }
}

/** Executa e grava no histórico (mantém só as últimas execuções do fluxo). */
export async function executarEGravar(
  flowId: string,
  fluxo: { nodes: FlowNode[]; edges: FlowEdge[] },
  entrada: unknown,
  origem: "webhook" | "teste",
): Promise<ExecutionRow> {
  const resultado = await executarFluxo(fluxo, entrada, origem === "teste")
  const gravada = await prisma.noCodeExecution.create({
    data: {
      flowId,
      status: resultado.status,
      origem,
      entrada: (entrada ?? null) as never,
      passos: resultado.passos as never,
      erro: resultado.erro,
      duracaoMs: resultado.duracaoMs,
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

  // Poda o histórico antigo.
  const antigos = await prisma.noCodeExecution.findMany({
    where: { flowId },
    orderBy: { iniciadoEm: "desc" },
    skip: MAX_EXECUCOES_POR_FLUXO,
    select: { id: true },
  })
  if (antigos.length > 0) {
    await prisma.noCodeExecution.deleteMany({ where: { id: { in: antigos.map((a) => a.id) } } })
  }

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

/** Valida fluxo + token antes de aceitar o evento (a execução em si roda depois da resposta). */
export async function prepararWebhook(flowId: string, token: string | null): Promise<PreparoWebhook> {
  const fluxo = await getFlow(flowId)
  if (!fluxo) return { ok: false, status: 404, erro: "Fluxo não encontrado." }

  const gatilho = fluxo.nodes.find((n) => n.type === "webhook")
  const esperado = String(gatilho?.config.token ?? "")
  if (!esperado || !token || !tokensIguais(token, esperado)) {
    return { ok: false, status: 401, erro: "Token inválido." }
  }
  // 202: aceito mas sem processar, para a Evolution não ficar reenviando.
  if (!fluxo.ativo && !fluxo.sistema) return { ok: false, status: 202, erro: "Fluxo desativado." }
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

    await executarEGravar(fluxo.id, fluxo, payload, "webhook")
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
    where: { OR: [{ ativo: true }, { sistema: true }] },
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
