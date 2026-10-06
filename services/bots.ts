import { escolherOpcao, opcoesDoMenu, validarGrafo, type FlowEdge, type FlowNode } from "@/lib/nocode/catalog"
import { prisma } from "@/lib/prisma"
import { recordAppLog } from "@/services/app-logs"
import { pausarBot } from "@/services/bot-estado"
import { CrmError } from "@/services/crm"
import { extrairMensagem, localizarLeadPorTelefone, telefoneDoRemoteJid } from "@/services/lead-response"
import { createBot, desativarBotsConcorrentes, executarFluxo, gravarExecucao, type ContextoBot } from "@/services/nocode"
import { cadastrarLeadPorMensagem } from "@/services/leads"
import { getChatPluginAtivo, getCrmPluginAtivo } from "@/services/settings"

/**
 * Bots de departamento: fluxos No Code do tipo "bot" que respondem às mensagens que os leads
 * mandam no WhatsApp.
 *
 * Quem responde, para uma mensagem de um lead:
 *   1. Bot pausado na conversa (um humano assumiu) → ninguém: o bot só volta quando alguém o
 *      reativa nessa conversa (`reativarBot`).
 *   2. Menu esperando a resposta do lead → o MESMO bot retoma dali e segue a opção escolhida.
 *   3. Conversa já num departamento → o bot ativo desse departamento (se houver).
 *   4. Conversa sem departamento → o bot de entrada ativo (triagem), se houver.
 *
 * É chamado pelo webhook do fluxo de resposta do sistema (ver app/api/nocode/webhook), depois
 * de o fluxo registrar a resposta. Nunca lança: erro de bot não pode derrubar o recebimento.
 */

/** Respostas inválidas seguidas ao mesmo menu antes de o bot desistir (fica quieto até um humano agir). */
const MAX_TENTATIVAS_MENU = 3
/** Recomeço padrão (em horas) quando o gatilho não define `reiniciarAposHoras`. */
const REINICIAR_PADRAO_HORAS = 12
/** Um menu sem resposta expira depois disso: a próxima mensagem recomeça o bot do início. */
const EXPIRA_ESPERA_MS = 24 * 60 * 60 * 1000

type Contexto = Record<string, unknown>

type BotCarregado = {
  id: string
  nome: string
  nodes: FlowNode[]
  edges: FlowEdge[]
}

type Conversa = {
  lead: { id: string; nome: string; telefone: string; status: string }
  /** Telefone do remetente como a Evolution entregou (é o melhor endereço para responder). */
  telefone: string
  texto: string
  payload: unknown
}

declare global {
  // eslint-disable-next-line no-var
  var __botFilas: Map<string, Promise<void>> | undefined
}

/**
 * Fila por lead, em `globalThis` (o módulo pode ser avaliado mais de uma vez; ver
 * lib/workspace-context.ts). Duas mensagens seguidas do mesmo lead não rodam o bot em paralelo.
 */
function filas(): Map<string, Promise<void>> {
  return (globalThis.__botFilas ??= new Map())
}

export async function processarMensagemParaBots(payload: unknown): Promise<void> {
  try {
    // Só mensagens novas contam (a Evolution também avisa de leitura, status, conexão…).
    const evento = String((payload as { event?: unknown } | null)?.event ?? "")
      .trim()
      .toLowerCase()
      .replace(/[_-]/g, ".")
    if (evento && evento !== "messages.upsert") return

    const msg = extrairMensagem(payload)
    // Mensagem enviada por nós (inclusive as do próprio bot) volta pelo webhook com fromMe = true.
    if (msg.fromMe) return
    // Grupos e status do WhatsApp não são conversa com um lead.
    if (msg.remoteJid.endsWith("@g.us") || msg.remoteJid.startsWith("status@")) return
    const telefone = telefoneDoRemoteJid(msg.remoteJid)
    if (!telefone) return
    // Os bots ficam no CRM: com o plugin desligado nenhum bot responde.
    if (!(await getCrmPluginAtivo())) return
    const lead = await localizarOuCadastrarLead(telefone, msg.remoteJid, msg.pushName)
    if (!lead) return

    const conversa: Conversa = { lead, telefone, texto: msg.texto.trim(), payload }
    const anterior = filas().get(lead.id) ?? Promise.resolve()
    const atual = anterior.catch(() => undefined).then(() => atender(conversa))
    filas().set(lead.id, atual)
    try {
      await atual
    } finally {
      if (filas().get(lead.id) === atual) filas().delete(lead.id)
    }
  } catch (error) {
    await recordAppLog({ nivel: "erro", origem: "bots", mensagem: "Falha ao processar mensagem para os bots.", detalhes: error })
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __botCadastros: Map<string, Promise<unknown>> | undefined
}

/**
 * Acha o lead do telefone. Com os plugins Chat e CRM ativos, quem escreve sem estar cadastrado é
 * cadastrado na hora (para o bot poder responder e a conversa aparecer no chat). Sem os dois
 * plugins, só leads já cadastrados são atendidos. Mensagens seguidas de um mesmo número novo
 * esperam uma à outra, para não criar o lead duas vezes.
 */
async function localizarOuCadastrarLead(telefone: string, remoteJid: string, nomePerfil: string | null) {
  const existente = await localizarLeadPorTelefone(telefone)
  if (existente) return existente
  // Só números reais de WhatsApp: ids "@lid" e afins não são telefones.
  if (!remoteJid.endsWith("@s.whatsapp.net")) return null
  if (!(await getChatPluginAtivo())) return null

  const chave = telefone.replace(/\D/g, "").slice(-8)
  const cadastros = (globalThis.__botCadastros ??= new Map())
  const anterior = cadastros.get(chave) ?? Promise.resolve()
  const atual = anterior
    .catch(() => undefined)
    .then(async () => (await localizarLeadPorTelefone(telefone)) ?? (await cadastrarLeadPorMensagem({ telefone, nomePerfil })))
  cadastros.set(chave, atual)
  try {
    return (await atual) as Awaited<ReturnType<typeof localizarLeadPorTelefone>>
  } finally {
    if (cadastros.get(chave) === atual) cadastros.delete(chave)
  }
}

async function carregarBot(where: { id?: string; botEntrada?: boolean; departamentoId?: string }): Promise<BotCarregado | null> {
  const row = await prisma.noCodeFlow.findFirst({
    where: { tipo: "bot", ativo: true, ...where },
    orderBy: { atualizadoEm: "desc" },
    select: { id: true, nome: true, nodes: true, edges: true },
  })
  if (!row) return null
  return {
    id: row.id,
    nome: row.nome,
    nodes: Array.isArray(row.nodes) ? (row.nodes as unknown as FlowNode[]) : [],
    edges: Array.isArray(row.edges) ? (row.edges as unknown as FlowEdge[]) : [],
  }
}

/** Horas sem conversar para o bot recomeçar do início (0 = recomeça a cada mensagem). */
function horasParaReiniciar(bot: BotCarregado): number {
  const gatilho = bot.nodes.find((n) => n.type === "mensagem_recebida")
  const valor = Number(gatilho?.config?.reiniciarAposHoras)
  if (!Number.isFinite(valor) || gatilho?.config?.reiniciarAposHoras === undefined || gatilho?.config?.reiniciarAposHoras === "") {
    return REINICIAR_PADRAO_HORAS
  }
  return Math.min(Math.max(valor, 0), 24 * 30)
}

async function atender(conversa: Conversa): Promise<void> {
  try {
    await atenderConversa(conversa)
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "bots",
      mensagem: "Falha ao atender a conversa com o bot.",
      detalhes: error,
      contexto: { leadId: conversa.lead.id },
    })
  }
}

async function atenderConversa({ lead, telefone, texto, payload }: Conversa): Promise<void> {
  const [estado, atendimento] = await Promise.all([
    prisma.botConversa.findUnique({ where: { leadId: lead.id } }),
    prisma.leadAtendimento.findUnique({
      where: { leadId: lead.id },
      select: { departamentoId: true, atendenteId: true, departamento: { select: { id: true, nome: true } } },
    }),
  ])

  // 1. Bot pausado nesta conversa: só uma pessoa o reativa.
  if (estado && !estado.botAtivo) return
  // Conversa que já tinha atendente antes de o bot existir nela: tratada como assumida.
  if (!estado && atendimento?.atendenteId) {
    await pausarBot(lead.id, "A conversa já estava com um atendente.")
    return
  }

  const departamentoId = atendimento?.departamentoId ?? null
  const agora = Date.now()

  // 2. Menu esperando resposta: o mesmo bot retoma dali.
  let bot: BotCarregado | null = null
  let menu: FlowNode | null = null
  if (estado?.flowId && estado.aguardandoNoId && agora - estado.ultimaInteracaoEm.getTime() <= EXPIRA_ESPERA_MS) {
    const candidato = await carregarBot({ id: estado.flowId })
    const no = candidato?.nodes.find((n) => n.id === estado.aguardandoNoId && n.type === "menu") ?? null
    if (candidato && no) {
      bot = candidato
      menu = no
    }
  }

  // 3 e 4. Sessão nova: bot do departamento da conversa, ou o de entrada se ela não tem departamento.
  if (!bot) {
    bot = departamentoId ? await carregarBot({ departamentoId }) : await carregarBot({ botEntrada: true })
    if (!bot) return
    const horas = horasParaReiniciar(bot)
    const ultima = estado?.ultimaInteracaoEm.getTime() ?? 0
    const jaAtendeu = estado?.flowId === bot.id && !estado.aguardandoNoId
    // Já respondeu há pouco: não repete o mesmo atendimento a cada mensagem do lead.
    if (jaAtendeu && horas > 0 && agora - ultima < horas * 60 * 60 * 1000) return
  }

  const contexto: Contexto = {
    mensagem: texto,
    telefone,
    lead: {
      encontrado: true,
      id: lead.id,
      nome: lead.nome,
      status: lead.status,
      temCampanha: false,
      campanhasIds: [],
    },
    departamento: atendimento?.departamento ? { id: atendimento.departamento.id, nome: atendimento.departamento.nome } : null,
    bot: { leadId: lead.id, flowNome: bot.nome } satisfies ContextoBot,
  }

  let filaInicial: string[] | undefined
  let tentativas = 0

  if (menu) {
    // Reserva a resposta: se o webhook chegar duplicado, só a primeira passa.
    const reserva = await prisma.botConversa.updateMany({
      where: { leadId: lead.id, aguardandoNoId: menu.id },
      data: { aguardandoNoId: null },
    })
    if (reserva.count === 0) return

    const opcoes = opcoesDoMenu(menu.config)
    const indice = escolherOpcao(texto, opcoes)
    const idMenu = menu.id
    const saidaOutra = bot.edges.some((e) => e.source === idMenu && e.sourceHandle === "outra")

    if (indice >= 0 || saidaOutra) {
      const saida = indice >= 0 ? `op_${indice + 1}` : "outra"
      filaInicial = bot.edges.filter((e) => e.source === idMenu && e.sourceHandle === saida).map((e) => e.target)
      if (indice >= 0) contexto.opcao = { numero: indice + 1, texto: opcoes[indice] }
    } else {
      tentativas = (estado?.tentativas ?? 0) + 1
      if (tentativas > MAX_TENTATIVAS_MENU) {
        // Desiste: o bot fica quieto até um humano agir (ou a sessão expirar).
        await prisma.botConversa.update({ where: { leadId: lead.id }, data: { tentativas: 0, ultimaInteracaoEm: new Date() } })
        return
      }
      filaInicial = [idMenu]
      contexto.botInvalido = true
    }

    if (filaInicial.length === 0) {
      // Opção sem nada conectado: não há o que executar; a sessão termina aqui.
      await guardarEstado(lead.id, bot.id, null, 0)
      return
    }
  }

  await registrarMensagemDoLead(lead, texto)

  const resultado = await executarFluxo({ nodes: bot.nodes, edges: bot.edges }, payload, false, {
    kind: "bot",
    filaInicial,
    ctxInicial: contexto,
  })

  await gravarExecucao(
    bot.id,
    { origem: "bot", leadId: lead.id, telefone, mensagem: texto, retomada: Boolean(menu) },
    "webhook",
    resultado,
  )

  await guardarEstado(lead.id, bot.id, resultado.espera?.nodeId ?? null, resultado.espera ? tentativas : 0)
}

/** Guarda em que ponto o bot parou. Não mexe em `botAtivo`: pausar/reativar é decisão de uma pessoa. */
async function guardarEstado(leadId: string, flowId: string, aguardandoNoId: string | null, tentativas: number): Promise<void> {
  const dados = { flowId, aguardandoNoId, tentativas, ultimaInteracaoEm: new Date() }
  await prisma.botConversa.upsert({
    where: { leadId },
    create: { leadId, ...dados },
    update: dados,
  })
}

/**
 * Garante que a mensagem do lead apareça no chat. Para leads em campanha o fluxo de resposta já a
 * registrou (e não duplicamos); para os demais ela ficaria sem registro, e a conversa com o bot
 * mostraria só as respostas do bot.
 */
async function registrarMensagemDoLead(lead: { id: string; nome: string }, texto: string): Promise<void> {
  const detalhes = `Resposta: "${texto || "(mensagem sem texto)"}"`
  const recente = await prisma.timelineEvent.findFirst({
    where: { leadId: lead.id, tipo: "resposta", detalhes, data: { gte: new Date(Date.now() - 60_000) } },
    select: { id: true },
  })
  if (recente) return
  await prisma.timelineEvent.create({
    data: {
      leadId: lead.id,
      campanhaId: null,
      mensagemId: null,
      tipo: "resposta",
      descricao: `${lead.nome} respondeu no WhatsApp.`,
      detalhes,
      sucesso: true,
    },
  })
}

// ---------------------------------------------------------------------------
// Gestão dos bots (página do CRM)
// ---------------------------------------------------------------------------

/** Cria um bot (de entrada, se `departamentoId` for nulo, ou de um departamento). Nasce desativado. */
export async function criarBotDoCrm(input: { nome: string; departamentoId: string | null }): Promise<{ id: string }> {
  const nome = String(input.nome ?? "").trim()
  if (nome.length < 2 || nome.length > 80) throw new CrmError("Informe o nome do bot (de 2 a 80 caracteres).")
  if (input.departamentoId) {
    const departamento = await prisma.departamento.findUnique({ where: { id: input.departamentoId }, select: { id: true } })
    if (!departamento) throw new CrmError("Departamento não encontrado.")
  }
  const fluxo = await createBot({ nome, departamentoId: input.departamentoId })
  return { id: fluxo.id }
}

/**
 * Liga ou desliga um bot. Só um bot fica ativo por escopo (o de entrada, ou um por departamento):
 * ao ativar, os outros do mesmo escopo são desativados e a contagem volta para avisar a tela.
 */
export async function ativarBotDoCrm(id: string, ativo: boolean): Promise<{ desativados: number }> {
  const bot = await prisma.noCodeFlow.findFirst({
    where: { id, tipo: "bot" },
    select: { id: true, botEntrada: true, departamentoId: true, nodes: true, edges: true },
  })
  if (!bot) throw new CrmError("Bot não encontrado.")
  if (!ativo) {
    await prisma.noCodeFlow.update({ where: { id }, data: { ativo: false } })
    return { desativados: 0 }
  }
  if (!bot.botEntrada && !bot.departamentoId) {
    throw new CrmError("O departamento deste bot foi excluído. Crie um novo bot em um departamento existente.")
  }
  const nodes = Array.isArray(bot.nodes) ? (bot.nodes as unknown as FlowNode[]) : []
  const edges = Array.isArray(bot.edges) ? (bot.edges as unknown as FlowEdge[]) : []
  const erro = validarGrafo(nodes, edges, true, "bot")
  if (erro) throw new CrmError(erro)
  const desativados = await desativarBotsConcorrentes(bot)
  await prisma.noCodeFlow.update({ where: { id }, data: { ativo: true } })
  return { desativados }
}

export async function excluirBotDoCrm(id: string): Promise<void> {
  const apagados = await prisma.noCodeFlow.deleteMany({ where: { id, tipo: "bot" } })
  if (apagados.count === 0) throw new CrmError("Bot não encontrado.")
}
