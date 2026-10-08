import {
  infoDoProvedor,
  LIMITE_NOME_AGENTE,
  LIMITE_PROMPT_AGENTE,
  PROVEDORES,
  REATIVACAO_MAX_MINUTOS,
  REATIVACAO_MIN_MINUTOS,
  descreverTempo,
  type ProvedorIa,
} from "@/lib/agentes-ia"
import { prisma } from "@/lib/prisma"
import { criptografar, descriptografar, finalDaChave } from "@/lib/segredo"
import { pausaPorHumanoAssumir, reativarBot } from "@/services/bot-estado"
import { recordAppLog } from "@/services/app-logs"
import { sendWhatsAppText } from "@/services/evolution"
import { exigirPlugin } from "@/services/settings"

/**
 * Plugin Agentes de IA: agentes de atendimento (Claude, Groq ou outra API compatível com a da
 * OpenAI, via chave de API) que respondem as mensagens do chat. Por enquanto o agente SÓ CONVERSA: não executa comandos nem usa ferramentas.
 *
 * Quem aciona o agente é `services/bots.ts` (mesma regra dos bots: só conversas sem campanha e
 * sem humano assumindo). Aqui ficam o cadastro dos agentes, os vínculos (departamento / entrada)
 * e a chamada à API do provedor.
 */

export class AgenteIaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AgenteIaError"
  }
}

// ---------------------------------------------------------------------------
// Tipos (serializáveis: trafegam do servidor para os componentes)
// ---------------------------------------------------------------------------

export type AgenteIaItem = {
  id: string
  nome: string
  ativo: boolean
  provedor: ProvedorIa
  /** Endereço base da API (só "compativel"). */
  baseUrl: string | null
  modelo: string
  prompt: string
  /** É o agente de entrada (atende quem ainda não está em nenhum departamento). */
  entrada: boolean
  /** Reativação automática depois de X minutos sem atividade da equipe. Nulo = desligada. */
  reativarAposMinutos: number | null
  temChave: boolean
  /** Final da chave (`…a1b2`) para conferência. A chave inteira nunca sai do servidor. */
  chaveFinal: string | null
  departamentos: { id: string; nome: string }[]
}

export type AgenteIaInput = {
  nome: string
  provedor: string
  /** Só para o provedor "compativel". */
  baseUrl?: string | null
  modelo: string
  prompt: string
  /** Vazio na edição = mantém a chave já salva. */
  apiKey?: string | null
  /** Reativação automática em minutos; nulo/ausente = desligada. */
  reativarAposMinutos?: number | null
}

export type ModeloIa = { id: string; nome: string }

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

function validarBaseUrl(valor: string): string {
  let url: URL
  try {
    url = new URL(valor)
  } catch {
    throw new AgenteIaError("Endereço da API inválido. Use algo como https://api.openai.com/v1.")
  }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== "https:") throw new AgenteIaError("O endereço da API precisa começar com https://.")
  if (url.username || url.password) throw new AgenteIaError("Não coloque usuário ou senha no endereço da API.")
  // O servidor faz a chamada: não aceita endereços internos.
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host) ||
    host === "[::1]"
  ) {
    throw new AgenteIaError("Endereços internos não são permitidos. Use o endereço público da API.")
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "")
}

function validar(input: AgenteIaInput) {
  const provedor = PROVEDORES.find((p) => p.key === input.provedor)?.key
  if (!provedor) throw new AgenteIaError("Escolha o provedor de IA do agente.")
  const baseUrl = provedor === "compativel" ? validarBaseUrl(String(input.baseUrl ?? "").trim()) : null
  const nome = String(input.nome ?? "").trim()
  const modelo = String(input.modelo ?? "").trim()
  const prompt = String(input.prompt ?? "").trim()
  if (nome.length < 2) throw new AgenteIaError("Informe o nome do agente (mínimo de 2 caracteres).")
  if (nome.length > LIMITE_NOME_AGENTE) throw new AgenteIaError(`O nome pode ter no máximo ${LIMITE_NOME_AGENTE} caracteres.`)
  if (!modelo || modelo.length > 120) throw new AgenteIaError("Escolha o modelo do agente.")
  if (prompt.length < 10) throw new AgenteIaError("Escreva o prompt do agente (mínimo de 10 caracteres).")
  if (prompt.length > LIMITE_PROMPT_AGENTE) throw new AgenteIaError(`O prompt pode ter no máximo ${LIMITE_PROMPT_AGENTE} caracteres.`)
  let reativarAposMinutos: number | null = null
  if (input.reativarAposMinutos !== null && input.reativarAposMinutos !== undefined) {
    const minutos = Number(input.reativarAposMinutos)
    if (!Number.isInteger(minutos) || minutos < REATIVACAO_MIN_MINUTOS || minutos > REATIVACAO_MAX_MINUTOS) {
      throw new AgenteIaError("O tempo de reativação automática deve ficar entre 1 minuto e 30 dias.")
    }
    reativarAposMinutos = minutos
  }
  return { nome, modelo, prompt, provedor, baseUrl, reativarAposMinutos }
}

function limparChave(valor: unknown): string {
  const chave = typeof valor === "string" ? valor.trim() : ""
  if (chave && (chave.length < 20 || chave.length > 400 || /\s/.test(chave))) {
    throw new AgenteIaError("A chave de API parece inválida. Copie a chave inteira, sem espaços.")
  }
  return chave
}

export async function listarAgentes(): Promise<AgenteIaItem[]> {
  const linhas = await prisma.agenteIA.findMany({
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
    select: {
      id: true,
      nome: true,
      ativo: true,
      provedor: true,
      baseUrl: true,
      modelo: true,
      prompt: true,
      entrada: true,
      reativarAposMinutos: true,
      apiKey: true,
      departamentos: { select: { id: true, nome: true }, orderBy: { nome: "asc" } },
    },
  })
  return linhas.map((a) => {
    const chave = descriptografar(a.apiKey)
    return {
      id: a.id,
      nome: a.nome,
      ativo: a.ativo,
      provedor: infoDoProvedor(a.provedor).key,
      baseUrl: a.baseUrl,
      modelo: a.modelo,
      prompt: a.prompt,
      entrada: a.entrada,
      reativarAposMinutos: a.reativarAposMinutos,
      temChave: Boolean(chave),
      chaveFinal: finalDaChave(chave),
      departamentos: a.departamentos,
    }
  })
}

export async function criarAgente(input: AgenteIaInput): Promise<{ id: string }> {
  await exigirPlugin("agentesIa")
  const dados = validar(input)
  const chave = limparChave(input.apiKey)
  if (!chave) throw new AgenteIaError("Informe a chave de API do provedor.")
  const criado = await prisma.agenteIA.create({
    data: { ...dados, apiKey: criptografar(chave), ativo: false },
    select: { id: true },
  })
  return { id: criado.id }
}

export async function atualizarAgente(id: string, input: AgenteIaInput): Promise<void> {
  await exigirPlugin("agentesIa")
  const dados = validar(input)
  const chave = limparChave(input.apiKey)
  const existente = await prisma.agenteIA.findUnique({ where: { id }, select: { id: true, provedor: true } })
  if (!existente) throw new AgenteIaError("Agente não encontrado.")
  // A chave salva pertence ao provedor antigo: ao trocar de provedor é preciso informar a nova.
  if (existente.provedor !== dados.provedor && !chave) throw new AgenteIaError("Ao trocar o provedor, informe a chave de API do novo provedor.")
  await prisma.agenteIA.update({ where: { id }, data: { ...dados, ...(chave ? { apiKey: criptografar(chave) } : {}) } })
}

export async function ativarAgente(id: string, ativo: boolean): Promise<void> {
  const agente = await prisma.agenteIA.findUnique({ where: { id }, select: { id: true, apiKey: true, prompt: true } })
  if (!agente) throw new AgenteIaError("Agente não encontrado.")
  if (ativo) {
    await exigirPlugin("agentesIa")
    if (!descriptografar(agente.apiKey)) throw new AgenteIaError("Informe a chave de API do agente antes de ativá-lo.")
    if (!agente.prompt.trim()) throw new AgenteIaError("Escreva o prompt do agente antes de ativá-lo.")
  }
  await prisma.agenteIA.update({ where: { id }, data: { ativo } })
}

export async function excluirAgente(id: string): Promise<void> {
  const apagados = await prisma.agenteIA.deleteMany({ where: { id } })
  if (apagados.count === 0) throw new AgenteIaError("Agente não encontrado.")
}

// ---------------------------------------------------------------------------
// Vínculos (usados pela aba CRM)
// ---------------------------------------------------------------------------

/** Liga (ou, com `null`, desliga) o agente que atende um departamento. */
export async function vincularAgenteAoDepartamento(departamentoId: string, agenteId: string | null): Promise<void> {
  await exigirPlugin("agentesIa", "crm")
  const departamento = await prisma.departamento.findUnique({ where: { id: departamentoId }, select: { id: true } })
  if (!departamento) throw new AgenteIaError("Departamento não encontrado.")
  if (agenteId) {
    const agente = await prisma.agenteIA.findUnique({ where: { id: agenteId }, select: { id: true } })
    if (!agente) throw new AgenteIaError("Agente não encontrado.")
  }
  await prisma.departamento.update({ where: { id: departamentoId }, data: { agenteIaId: agenteId } })
}

/** Define (ou, com `null`, remove) o agente de entrada. Só um por instância. */
export async function definirAgenteDeEntrada(agenteId: string | null): Promise<void> {
  await exigirPlugin("agentesIa", "crm")
  if (agenteId) {
    const agente = await prisma.agenteIA.findUnique({ where: { id: agenteId }, select: { id: true } })
    if (!agente) throw new AgenteIaError("Agente não encontrado.")
  }
  await prisma.agenteIA.updateMany({ where: { entrada: true, ...(agenteId ? { id: { not: agenteId } } : {}) }, data: { entrada: false } })
  if (agenteId) await prisma.agenteIA.update({ where: { id: agenteId }, data: { entrada: true } })
}

// ---------------------------------------------------------------------------
// APIs dos provedores (Anthropic e compatíveis com a da OpenAI, como Groq)
// ---------------------------------------------------------------------------

const VERSAO_API_ANTHROPIC = "2023-06-01"
const TIMEOUT_MS = 45_000
const MAX_TOKENS_RESPOSTA = 1024

type Conexao = { provedor: ProvedorIa; baseUrl: string; chave: string }

function conexaoDe(provedor: string, baseUrl: string | null, chave: string): Conexao {
  const info = infoDoProvedor(provedor)
  const base = info.baseUrl ?? baseUrl
  if (!base) throw new AgenteIaError("Informe o endereço da API do provedor.")
  return { provedor: info.key, baseUrl: base, chave }
}

async function erroDaApi(resposta: Response, provedor: ProvedorIa): Promise<string> {
  const nome = infoDoProvedor(provedor).label
  let detalhe = ""
  try {
    const corpo = (await resposta.json()) as { error?: { message?: string } | string }
    detalhe = typeof corpo?.error === "string" ? corpo.error : (corpo?.error?.message ?? "")
  } catch {
    // corpo não JSON
  }
  if (resposta.status === 401) return `Chave de API recusada por ${nome} (401). Confira a chave.`
  if (resposta.status === 403) return `A chave de API não tem permissão para esta operação (403).`
  if (resposta.status === 404) return detalhe || "Modelo ou endereço não encontrado (404). Confira o modelo e o endereço da API."
  if (resposta.status === 429) return `Limite de uso de ${nome} atingido (429). Tente de novo em instantes.`
  return detalhe || `${nome} respondeu com status ${resposta.status}.`
}

function cabecalhos(c: Conexao, json = false): Record<string, string> {
  const base: Record<string, string> =
    c.provedor === "claude" ? { "x-api-key": c.chave, "anthropic-version": VERSAO_API_ANTHROPIC } : { authorization: `Bearer ${c.chave}` }
  return json ? { ...base, "content-type": "application/json" } : base
}

/** Modelos que não conversam (áudio, moderação, embeddings) ficam fora da lista. */
const NAO_CONVERSA = /whisper|tts|guard|embed|orpheus|moderation|transcri/i

/** Modelos disponíveis para a chave (GET /models). Serve também para testar a chave. */
export async function listarModelosDoProvedor(input: {
  provedor: string
  baseUrl?: string | null
  apiKey?: string | null
  agenteId?: string | null
}): Promise<ModeloIa[]> {
  let chave = limparChave(input.apiKey)
  if (!chave && input.agenteId) {
    const agente = await prisma.agenteIA.findUnique({ where: { id: input.agenteId }, select: { apiKey: true, provedor: true } })
    // A chave salva só vale para o mesmo provedor.
    if (agente && agente.provedor === input.provedor) chave = descriptografar(agente.apiKey) ?? ""
  }
  if (!chave) throw new AgenteIaError("Informe a chave de API para carregar os modelos.")

  const info = infoDoProvedor(input.provedor)
  const baseUrl = info.baseUrl ?? validarBaseUrl(String(input.baseUrl ?? "").trim())
  const conexao = conexaoDe(info.key, baseUrl, chave)
  const url = conexao.provedor === "claude" ? `${conexao.baseUrl}/models?limit=100` : `${conexao.baseUrl}/models`

  let resposta: Response
  try {
    resposta = await fetch(url, { headers: cabecalhos(conexao), signal: AbortSignal.timeout(20_000) })
  } catch {
    throw new AgenteIaError(`Não foi possível falar com ${info.label}. Verifique a conexão do servidor e o endereço da API.`)
  }
  if (!resposta.ok) throw new AgenteIaError(await erroDaApi(resposta, conexao.provedor))
  const corpo = (await resposta.json()) as { data?: { id?: string; display_name?: string }[] }
  return (corpo.data ?? [])
    .filter((m): m is { id: string; display_name?: string } => typeof m.id === "string" && m.id.length > 0 && !NAO_CONVERSA.test(m.id))
    .map((m) => ({ id: m.id, nome: m.display_name || m.id }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

type MensagemIa = { role: "user" | "assistant"; content: string }

async function chamarModelo(input: { conexao: Conexao; modelo: string; system: string; mensagens: MensagemIa[] }): Promise<string> {
  const { conexao } = input
  const claude = conexao.provedor === "claude"
  const url = `${conexao.baseUrl}${claude ? "/messages" : "/chat/completions"}`
  const corpo = claude
    ? { model: input.modelo, max_tokens: MAX_TOKENS_RESPOSTA, system: input.system, messages: input.mensagens }
    : { model: input.modelo, max_tokens: MAX_TOKENS_RESPOSTA, messages: [{ role: "system", content: input.system }, ...input.mensagens] }

  let resposta: Response
  try {
    resposta = await fetch(url, {
      method: "POST",
      headers: cabecalhos(conexao, true),
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    const nome = infoDoProvedor(conexao.provedor).label
    throw new AgenteIaError(error instanceof Error && error.name === "TimeoutError" ? `${nome} demorou demais para responder.` : `Falha de conexão com ${nome}.`)
  }
  if (!resposta.ok) throw new AgenteIaError(await erroDaApi(resposta, conexao.provedor))

  if (claude) {
    const json = (await resposta.json()) as { content?: { type?: string; text?: string }[] }
    return (json.content ?? [])
      .filter((bloco) => bloco.type === "text" && typeof bloco.text === "string")
      .map((bloco) => bloco.text as string)
      .join("\n")
      .trim()
  }
  const json = (await resposta.json()) as { choices?: { message?: { content?: string | null } }[] }
  return (json.choices?.[0]?.message?.content ?? "").trim()
}

// ---------------------------------------------------------------------------
// Atendimento: quem responde e como
// ---------------------------------------------------------------------------

export type AgenteCarregado = { id: string; nome: string; reativarAposMinutos: number | null; provedor: ProvedorIa; baseUrl: string | null; modelo: string; prompt: string; chave: string }

/**
 * Agente ativo (e com chave) que atende o escopo da conversa: o do departamento ou, sem
 * departamento, o de entrada. `null` = ninguém do plugin responde.
 */
export async function carregarAgenteDoEscopo(departamentoId: string | null): Promise<AgenteCarregado | null> {
  const linha = departamentoId
    ? (await prisma.departamento.findUnique({ where: { id: departamentoId }, select: { agenteIa: true } }))?.agenteIa
    : await prisma.agenteIA.findFirst({ where: { entrada: true } })
  if (!linha || !linha.ativo) return null
  const chave = descriptografar(linha.apiKey)
  if (!chave) return null
  return { id: linha.id, nome: linha.nome, reativarAposMinutos: linha.reativarAposMinutos, provedor: infoDoProvedor(linha.provedor).key, baseUrl: linha.baseUrl, modelo: linha.modelo, prompt: linha.prompt, chave }
}

/**
 * Agentes ativos (com chave) por escopo, para o chat mostrar qual agente atende cada conversa:
 * o de entrada e o de cada departamento. É a mesma regra de `carregarAgenteDoEscopo`.
 */
export async function listarEscoposDosAgentes(): Promise<{
  entrada: { nome: string } | null
  porDepartamento: Map<string, { nome: string }>
}> {
  const [entrada, departamentos] = await Promise.all([
    prisma.agenteIA.findFirst({ where: { entrada: true, ativo: true }, select: { nome: true, apiKey: true } }),
    prisma.departamento.findMany({
      where: { agenteIaId: { not: null }, agenteIa: { is: { ativo: true } } },
      select: { id: true, agenteIa: { select: { nome: true, apiKey: true } } },
    }),
  ])
  const porDepartamento = new Map<string, { nome: string }>()
  for (const d of departamentos) {
    if (d.agenteIa && descriptografar(d.agenteIa.apiKey)) porDepartamento.set(d.id, { nome: d.agenteIa.nome })
  }
  return { entrada: entrada && descriptografar(entrada.apiKey) ? { nome: entrada.nome } : null, porDepartamento }
}

/**
 * Reativação automática: o agente do escopo volta a responder uma conversa pausada quando
 *  - a opção está ligada nele,
 *  - a pausa veio de um humano assumindo a conversa (não pausa manual nem lead de campanha), e
 *  - já passou o tempo configurado desde a última atividade da equipe (a pausa ou a última
 *    mensagem enviada pelo chat, a que for mais recente; disparos de campanha não contam).
 * Não há agendador: a checagem acontece quando o lead manda a próxima mensagem.
 * Devolve `true` quando reativou (o agente já pode responder).
 */
export async function reativarAgenteSeVencido(
  agente: AgenteCarregado,
  lead: { id: string },
  estado: { pausadoEm: Date | null; pausadoMotivo: string | null },
): Promise<boolean> {
  if (!agente.reativarAposMinutos || !estado.pausadoEm || !pausaPorHumanoAssumir(estado.pausadoMotivo)) return false
  const ultimaDaEquipe = await prisma.timelineEvent.findFirst({
    where: { leadId: lead.id, tipo: "mensagem_enviada", campanhaId: null },
    orderBy: { data: "desc" },
    select: { data: true },
  })
  const referencia = Math.max(estado.pausadoEm.getTime(), ultimaDaEquipe?.data.getTime() ?? 0)
  if (Date.now() - referencia < agente.reativarAposMinutos * 60_000) return false

  await reativarBot(lead.id)
  await prisma.chatInternalNote.create({
    data: { leadId: lead.id, texto: `Agente de IA “${agente.nome}” reativado automaticamente após ${descreverTempo(agente.reativarAposMinutos)} sem atividade da equipe.` },
  })
  return true
}

const LIMITE_HISTORICO = 30
const LIMITE_TEXTO_MENSAGEM = 2000
const LIMITE_TEXTO_RESPOSTA = 3500
const SEM_TEXTO = "[mensagem sem texto: áudio, imagem ou arquivo]"

/** Texto de um evento da timeline (`Mensagem: "…"` / `Resposta: "…"`). */
function textoDoEvento(detalhes: string | null, tipo: string): string {
  const prefixo = tipo === "resposta" ? "Resposta:" : "Mensagem:"
  const valor = (detalhes ?? "").trim()
  if (!valor.startsWith(prefixo)) return valor
  const conteudo = valor.slice(prefixo.length).trim()
  const entreAspas = conteudo.match(/^"([\s\S]*)"\.?(?:\r?\n|$)/)
  return (entreAspas?.[1] ?? conteudo.replace(/^"|"$/g, "")).trim()
}

async function montarHistorico(leadId: string, textoAtual: string): Promise<MensagemIa[]> {
  const eventos = await prisma.timelineEvent.findMany({
    where: { leadId, tipo: { in: ["mensagem_enviada", "resposta"] } },
    select: { tipo: true, detalhes: true },
    orderBy: { data: "desc" },
    take: LIMITE_HISTORICO,
  })

  const mensagens: MensagemIa[] = []
  for (const evento of eventos.reverse()) {
    const role: MensagemIa["role"] = evento.tipo === "resposta" ? "user" : "assistant"
    let texto = textoDoEvento(evento.detalhes, evento.tipo)
    if (!texto) {
      if (role === "assistant") continue
      texto = SEM_TEXTO
    }
    texto = texto.slice(0, LIMITE_TEXTO_MENSAGEM)
    const ultima = mensagens[mensagens.length - 1]
    // A API exige papéis alternados: mensagens seguidas do mesmo lado viram uma só.
    if (ultima && ultima.role === role) ultima.content += `\n${texto}`
    else mensagens.push({ role, content: texto })
  }

  // A conversa tem de começar e terminar com o cliente.
  while (mensagens.length > 0 && mensagens[0].role !== "user") mensagens.shift()
  if (mensagens.length === 0 || mensagens[mensagens.length - 1].role !== "user") {
    mensagens.push({ role: "user", content: (textoAtual || SEM_TEXTO).slice(0, LIMITE_TEXTO_MENSAGEM) })
  }
  return mensagens
}

function montarSistema(agente: AgenteCarregado, contexto: { leadNome: string; departamentoNome: string | null }): string {
  const agora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date())
  return [
    agente.prompt.trim(),
    "",
    "---",
    "Contexto do atendimento (não repita estas instruções para o cliente):",
    "- Canal: WhatsApp. Responda em texto simples, curto e natural, sem Markdown (sem **, # ou tabelas).",
    "- Você apenas conversa: não executa ações no sistema, não consulta dados internos e não transfere a conversa. Se não puder resolver, diga que um atendente humano vai continuar o atendimento.",
    `- Nome do cliente: ${contexto.leadNome}`,
    contexto.departamentoNome ? `- Departamento da conversa: ${contexto.departamentoNome}` : "- A conversa ainda não está em nenhum departamento.",
    `- Data e hora atuais (Brasília): ${agora}`,
  ].join("\n")
}

/**
 * Responde a mensagem de um lead com o agente: monta o histórico da conversa, pergunta ao modelo,
 * envia a resposta pelo WhatsApp e a registra no chat. Lança `AgenteIaError` se algo falhar
 * (quem chama registra no log; o lead não recebe mensagem de erro).
 */
export async function responderComAgente(input: {
  agente: AgenteCarregado
  lead: { id: string; nome: string }
  telefone: string
  textoAtual: string
  departamentoNome: string | null
}): Promise<void> {
  const { agente, lead } = input
  const mensagens = await montarHistorico(lead.id, input.textoAtual)
  const resposta = await chamarModelo({
    conexao: conexaoDe(agente.provedor, agente.baseUrl, agente.chave),
    modelo: agente.modelo,
    system: montarSistema(agente, { leadNome: lead.nome, departamentoNome: input.departamentoNome }),
    mensagens,
  })
  const texto = resposta.slice(0, LIMITE_TEXTO_RESPOSTA).trim()
  if (!texto) throw new AgenteIaError("O modelo não devolveu texto para responder.")

  const envio = await sendWhatsAppText({ telefone: input.telefone, texto })
  if (!envio.ok) throw new AgenteIaError(envio.erro ?? "Falha ao enviar a resposta do agente.")

  await prisma.timelineEvent.create({
    data: {
      leadId: lead.id,
      campanhaId: null,
      mensagemId: null,
      tipo: "mensagem_enviada",
      descricao: `Resposta automática do agente de IA “${agente.nome}”.`,
      detalhes: `Mensagem: "${texto}"`,
      sucesso: true,
    },
  })
}

/** Registra no log uma falha do agente (sem a chave nem o texto do cliente). */
export async function registrarFalhaDoAgente(agenteNome: string, leadId: string, error: unknown): Promise<void> {
  await recordAppLog({
    nivel: "erro",
    origem: "agentes-ia",
    mensagem: `O agente de IA “${agenteNome}” não conseguiu responder a conversa.`,
    detalhes: error instanceof Error ? error.message : String(error),
    contexto: { leadId },
  })
}
