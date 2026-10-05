import { createHmac } from "node:crypto"

import { prisma } from "@/lib/prisma"
import { paraCadaWorkspace } from "@/lib/workspace-context"
import { recordAppLog } from "@/services/app-logs"

/**
 * Webhook de execuções do plugin No Code: cada execução (entrada, passos,
 * saídas, erro, tempos) é enviada, completa, para uma URL externa, para quem
 * quiser guardá-la fora do app.
 *
 * Garantias:
 * - uma execução = um POST (o header `X-Execution-Id` serve de chave de
 *   idempotência no destino, já que uma entrega que falhou é repetida);
 * - falhou? Volta a tentar com espera crescente (1, 2, 4… até 30 min) enquanto
 *   a execução ainda existir no app (24h no fluxo do sistema);
 * - várias instâncias do app não enviam a mesma execução duas vezes: a entrega
 *   é "reservada" no banco antes do envio.
 */

/** Quanto tempo as execuções do fluxo do sistema ficam guardadas (sem limite de quantidade). */
export const RETENCAO_EXECUCOES_SISTEMA_MS = 24 * 60 * 60 * 1000

const TIMEOUT_MS = 10_000
const ENVIANDO_EXPIRA_MS = 2 * 60 * 1000
const ESPERA_MAXIMA_MS = 30 * 60 * 1000
const CANDIDATOS_POR_VARREDURA = 200
const ENVIOS_POR_VARREDURA = 100
const ENVIOS_EM_PARALELO = 5
const ORCAMENTO_VARREDURA_MS = 45_000
const INTERVALO_PODA_MS = 60_000

export const EVENTO_EXECUCAO = "nocode.execution"
export const EVENTO_TESTE = "nocode.execution.test"

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export function validarUrlWebhook(valor: unknown): { ok: true; url: string } | { ok: false; erro: string } {
  const texto = String(valor ?? "").trim()
  if (!texto) return { ok: false, erro: "Informe a URL do webhook." }
  if (texto.length > 2000) return { ok: false, erro: "A URL do webhook é longa demais." }
  let url: URL
  try {
    url = new URL(texto)
  } catch {
    return { ok: false, erro: "URL inválida. Use algo como https://meu-servidor.com/execucoes." }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, erro: "A URL do webhook precisa começar com http:// ou https://." }
  }
  if (url.username || url.password) {
    return { ok: false, erro: "Não coloque usuário e senha na URL; use o segredo para assinar o envio." }
  }
  return { ok: true, url: url.toString() }
}

export interface ConfigWebhookExecucoes {
  ativo: boolean
  url: string
  temSegredo: boolean
}

export async function atualizarConfigWebhookExecucoes(
  flowId: string,
  input: {
    ativo: boolean
    url: string
    /** `undefined` mantém o segredo atual; `null` remove; texto define. */
    segredo?: string | null
  },
): Promise<ConfigWebhookExecucoes> {
  const row = await prisma.noCodeFlow.update({
    where: { id: flowId },
    data: {
      execWebhookAtivo: input.ativo,
      execWebhookUrl: input.url || null,
      ...(input.segredo !== undefined ? { execWebhookSegredo: input.segredo } : {}),
    },
    select: { execWebhookAtivo: true, execWebhookUrl: true, execWebhookSegredo: true },
  })
  return {
    ativo: row.execWebhookAtivo,
    url: row.execWebhookUrl ?? "",
    temSegredo: Boolean(row.execWebhookSegredo),
  }
}

export async function segredoSalvoDoFluxo(flowId: string): Promise<string | null> {
  const row = await prisma.noCodeFlow.findUnique({ where: { id: flowId }, select: { execWebhookSegredo: true } })
  return row?.execWebhookSegredo ?? null
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

interface Destino {
  url: string
  segredo: string | null
}

interface ResultadoEnvio {
  ok: boolean
  status?: number
  erro?: string
}

async function postar(
  destino: Destino,
  evento: string,
  corpo: unknown,
  execucaoId: string,
  tentativa: number,
): Promise<ResultadoEnvio> {
  const texto = JSON.stringify(corpo)
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "painel-campanhas-nocode/1.0",
    "x-execution-event": evento,
    "x-execution-id": execucaoId,
    "x-execution-attempt": String(tentativa),
  }
  if (destino.segredo) {
    headers["x-execution-signature"] = `sha256=${createHmac("sha256", destino.segredo).update(texto).digest("hex")}`
  }

  try {
    const resposta = await fetch(destino.url, {
      method: "POST",
      headers,
      body: texto,
      cache: "no-store",
      // Redirecionar um POST reenviaria o corpo para outro endereço sem você ver.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (resposta.status >= 200 && resposta.status < 300) return { ok: true, status: resposta.status }

    const detalhe = (await resposta.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 200)
    const redirecionou = resposta.status >= 300 && resposta.status < 400
    return {
      ok: false,
      status: resposta.status,
      erro: `${redirecionou ? "O destino respondeu com redirecionamento" : "O destino respondeu"} (HTTP ${resposta.status})${detalhe ? `: ${detalhe}` : ""}`,
    }
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
    return { ok: false, erro: timeout ? `Sem resposta em ${TIMEOUT_MS / 1000}s.` : error instanceof Error ? error.message : String(error) }
  }
}

interface FluxoInfo {
  id: string
  nome: string
  sistema: boolean
}

interface ExecucaoBruta {
  id: string
  flowId: string
  status: string
  origem: string
  entrada: unknown
  passos: unknown
  erro: string | null
  duracaoMs: number
  iniciadoEm: Date
}

/** Corpo enviado: tudo o que o app guarda sobre a execução. */
function montarCorpo(evento: string, fluxo: FluxoInfo, exec: ExecucaoBruta, tentativa: number) {
  return {
    evento,
    enviadoEm: new Date().toISOString(),
    tentativa,
    fluxo: { id: fluxo.id, nome: fluxo.nome, sistema: fluxo.sistema },
    execucao: {
      id: exec.id,
      fluxoId: exec.flowId,
      status: exec.status,
      origem: exec.origem,
      iniciadoEm: exec.iniciadoEm.toISOString(),
      duracaoMs: exec.duracaoMs,
      erro: exec.erro,
      entrada: exec.entrada ?? null,
      passos: Array.isArray(exec.passos) ? exec.passos : [],
    },
  }
}

/** Entrega uma execução. Nunca lança: o resultado fica gravado na própria execução. */
export async function entregarExecucao(id: string): Promise<"enviado" | "falha" | "ignorada"> {
  try {
    const agora = new Date()
    // Reserva a entrega: só quem conseguir mudar o estado envia (evita envio duplo entre processos).
    const reserva = await prisma.noCodeExecution.updateMany({
      where: {
        id,
        OR: [
          { webhookStatus: { in: ["pendente", "falha"] } },
          { webhookStatus: "enviando", webhookUltimaTentativaEm: { lt: new Date(agora.getTime() - ENVIANDO_EXPIRA_MS) } },
        ],
      },
      data: { webhookStatus: "enviando", webhookTentativas: { increment: 1 }, webhookUltimaTentativaEm: agora },
    })
    if (reserva.count === 0) return "ignorada"

    const row = await prisma.noCodeExecution.findUnique({
      where: { id },
      include: {
        flow: { select: { id: true, nome: true, sistema: true, execWebhookAtivo: true, execWebhookUrl: true, execWebhookSegredo: true } },
      },
    })
    if (!row) return "ignorada"

    const flow = row.flow
    if (!flow.execWebhookAtivo || !flow.execWebhookUrl) {
      // Desligaram o webhook no meio do caminho: devolve a execução à fila, sem contar a tentativa.
      await prisma.noCodeExecution.update({
        where: { id },
        data: { webhookStatus: "pendente", webhookTentativas: { decrement: 1 } },
      })
      return "ignorada"
    }

    const resultado = await postar(
      { url: flow.execWebhookUrl, segredo: flow.execWebhookSegredo },
      EVENTO_EXECUCAO,
      montarCorpo(EVENTO_EXECUCAO, flow, row, row.webhookTentativas),
      row.id,
      row.webhookTentativas,
    )

    if (resultado.ok) {
      await prisma.noCodeExecution.update({
        where: { id },
        data: { webhookStatus: "enviado", webhookErro: null, webhookEnviadoEm: new Date() },
      })
      return "enviado"
    }

    await prisma.noCodeExecution.update({
      where: { id },
      data: { webhookStatus: "falha", webhookErro: resultado.erro ?? "Falha desconhecida." },
    })
    // Só a primeira falha vira log; as repetições aparecem na própria execução.
    if (row.webhookTentativas === 1) {
      await recordAppLog({
        nivel: "aviso",
        origem: "nocode",
        mensagem: `Webhook de execuções: falha ao enviar a execução ${row.id}. Vamos tentar de novo automaticamente.`,
        detalhes: resultado.erro,
      })
    }
    return "falha"
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "nocode",
      mensagem: "Webhook de execuções: erro inesperado na entrega.",
      detalhes: error,
    }).catch(() => undefined)
    return "falha"
  }
}

/** Espera antes da próxima tentativa, a partir de quantas já foram feitas: 1, 2, 4… até 30 min. */
function esperaAposTentativas(tentativas: number): number {
  return Math.min(60_000 * 2 ** Math.max(tentativas - 1, 0), ESPERA_MAXIMA_MS)
}

async function entregarPendentes(): Promise<{ enviadas: number; falhas: number }> {
  const agora = Date.now()
  const candidatos = await prisma.noCodeExecution.findMany({
    where: {
      flow: { execWebhookAtivo: true },
      OR: [
        { webhookStatus: "pendente" },
        { webhookStatus: "falha" },
        { webhookStatus: "enviando", webhookUltimaTentativaEm: { lt: new Date(agora - ENVIANDO_EXPIRA_MS) } },
      ],
    },
    orderBy: { iniciadoEm: "asc" },
    take: CANDIDATOS_POR_VARREDURA,
    select: { id: true, webhookStatus: true, webhookTentativas: true, webhookUltimaTentativaEm: true },
  })

  const devidas = candidatos
    .filter((c) => {
      if (c.webhookStatus !== "falha" || !c.webhookUltimaTentativaEm) return true
      return agora - c.webhookUltimaTentativaEm.getTime() >= esperaAposTentativas(c.webhookTentativas)
    })
    .slice(0, ENVIOS_POR_VARREDURA)

  let enviadas = 0
  let falhas = 0
  const inicio = Date.now()
  for (let i = 0; i < devidas.length; i += ENVIOS_EM_PARALELO) {
    if (Date.now() - inicio > ORCAMENTO_VARREDURA_MS) break
    const lote = devidas.slice(i, i + ENVIOS_EM_PARALELO)
    const resultados = await Promise.all(lote.map((c) => entregarExecucao(c.id)))
    for (const r of resultados) {
      if (r === "enviado") enviadas += 1
      else if (r === "falha") falhas += 1
    }
  }
  return { enviadas, falhas }
}

/** Mensagem de teste: mesmo formato de uma execução real, marcada como teste. */
export async function enviarTesteWebhook(
  destino: Destino,
  amostra: { entrada: unknown; fluxo: FluxoInfo },
): Promise<{ ok: boolean; message: string }> {
  const agora = new Date()
  const exec: ExecucaoBruta = {
    id: "teste-webhook",
    flowId: amostra.fluxo.id,
    status: "sucesso",
    origem: "teste",
    entrada: amostra.entrada,
    passos: [
      { nodeId: "exemplo", nome: "Webhook", tipo: "webhook", status: "ok", saida: "main", resumo: "Evento recebido.", ms: 1 },
    ],
    erro: null,
    duracaoMs: 1,
    iniciadoEm: agora,
  }
  const resultado = await postar(destino, EVENTO_TESTE, montarCorpo(EVENTO_TESTE, amostra.fluxo, exec, 1), exec.id, 1)
  if (resultado.ok) return { ok: true, message: `Teste enviado: o destino respondeu HTTP ${resultado.status}.` }
  return { ok: false, message: resultado.erro ?? "Não foi possível enviar o teste." }
}

// ---------------------------------------------------------------------------
// Retenção (fluxo do sistema: 24h, sem limite de quantidade)
// ---------------------------------------------------------------------------

export async function podarExecucoesExpiradas(): Promise<number> {
  const corte = new Date(Date.now() - RETENCAO_EXECUCOES_SISTEMA_MS)
  const apagadas = await prisma.noCodeExecution.deleteMany({
    where: { iniciadoEm: { lt: corte }, flow: { sistema: true } },
  })
  return apagadas.count
}

let ultimaPoda = 0

/** Poda no máximo 1x por minuto por processo — barato de chamar a cada execução gravada. */
export async function podarExecucoesExpiradasComIntervalo(): Promise<void> {
  const agora = Date.now()
  if (agora - ultimaPoda < INTERVALO_PODA_MS) return
  ultimaPoda = agora
  await podarExecucoesExpiradas()
}

// ---------------------------------------------------------------------------
// Rotina periódica (timer interno + /api/cron)
// ---------------------------------------------------------------------------

let manutencaoEmAndamento = false

export interface ResultadoManutencaoNoCode {
  podadas: number
  enviadas: number
  falhas: number
  ignorado?: boolean
}

/** Apaga o que passou de 24h e (re)envia as execuções pendentes ao webhook. */
export async function manutencaoNoCode(): Promise<ResultadoManutencaoNoCode> {
  if (manutencaoEmAndamento) return { podadas: 0, enviadas: 0, falhas: 0, ignorado: true }
  manutencaoEmAndamento = true
  try {
    ultimaPoda = Date.now()
    // Cada instância tem os próprios fluxos, execuções e webhook de execuções.
    const parciais = await paraCadaWorkspace(
      async () => {
        const podadas = await podarExecucoesExpiradas()
        const { enviadas, falhas } = await entregarPendentes()
        return { podadas, enviadas, falhas }
      },
      (id, erro) => console.error(`[v0] falha na manutenção do No Code da instância ${id}:`, erro),
    )
    return parciais.reduce(
      (total, p) => ({ podadas: total.podadas + p.podadas, enviadas: total.enviadas + p.enviadas, falhas: total.falhas + p.falhas }),
      { podadas: 0, enviadas: 0, falhas: 0 },
    )
  } finally {
    manutencaoEmAndamento = false
  }
}
