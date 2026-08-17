import { createHmac, randomBytes } from "node:crypto"
import { after } from "next/server"

import { prisma } from "@/lib/prisma"
import { WEBHOOK_LIMITE } from "@/lib/webhook-events"

export interface Webhook {
  id: string
  nome: string
  url: string
  secret: string
  ativo: boolean
  eventos: string[]
  ultimoEnvioEm: string | null
  ultimoEnvioStatus: number | null
  criadoEm: string
}

export interface WebhookInput {
  nome: string
  url: string
  eventos: string[]
  ativo: boolean
}

type WebhookRow = {
  id: string
  nome: string
  url: string
  secret: string
  ativo: boolean
  eventos: string[]
  ultimoEnvioEm: Date | null
  ultimoEnvioStatus: number | null
  criadoEm: Date
}

function serializar(row: WebhookRow): Webhook {
  return {
    id: row.id,
    nome: row.nome,
    url: row.url,
    secret: row.secret,
    ativo: row.ativo,
    eventos: row.eventos,
    ultimoEnvioEm: row.ultimoEnvioEm?.toISOString() ?? null,
    ultimoEnvioStatus: row.ultimoEnvioStatus,
    criadoEm: row.criadoEm.toISOString(),
  }
}

export async function listWebhooks(): Promise<Webhook[]> {
  const rows = await prisma.webhook.findMany({ orderBy: { criadoEm: "asc" } })
  return rows.map(serializar)
}

export async function countWebhooks(): Promise<number> {
  return prisma.webhook.count()
}

export async function createWebhook(input: WebhookInput): Promise<Webhook> {
  /*
   * A checagem do limite e a inserção correm na mesma transação para que dois
   * envios simultâneos não consigam passar de WEBHOOK_LIMITE registros.
   */
  const row = await prisma.$transaction(async (tx) => {
    const total = await tx.webhook.count()
    if (total >= WEBHOOK_LIMITE) throw new WebhookLimiteError()

    return tx.webhook.create({
      data: {
        nome: input.nome,
        url: input.url,
        eventos: input.eventos,
        ativo: input.ativo,
        // Usado para assinar o payload no header X-Signature.
        secret: `whsec_${randomBytes(24).toString("hex")}`,
      },
    })
  })
  return serializar(row)
}

export async function updateWebhook(id: string, input: WebhookInput): Promise<Webhook> {
  const row = await prisma.webhook.update({
    where: { id },
    data: { nome: input.nome, url: input.url, eventos: input.eventos, ativo: input.ativo },
  })
  return serializar(row)
}

export async function deleteWebhook(id: string): Promise<void> {
  await prisma.webhook.delete({ where: { id } })
}

/** Erro dedicado para que a action diferencie limite atingido de falha real. */
export class WebhookLimiteError extends Error {
  constructor() {
    super(`Limite de ${WEBHOOK_LIMITE} webhooks atingido.`)
    this.name = "WebhookLimiteError"
  }
}

export interface WebhookEntrega {
  ok: boolean
  status: number | null
  detalhe: string
}

/**
 * Envia um payload para o webhook e registra o resultado. O corpo é assinado com
 * HMAC-SHA256 usando o secret do webhook, no mesmo formato que os provedores
 * usuais adotam, para que o destinatário possa validar a origem.
 */
export async function dispatchWebhook(id: string, evento: string, dados: unknown): Promise<WebhookEntrega> {
  const webhook = await prisma.webhook.findUnique({ where: { id } })
  if (!webhook) return { ok: false, status: null, detalhe: "Webhook não encontrado." }
  return enviar({ id: webhook.id, url: webhook.url, secret: webhook.secret }, evento, dados)
}

/**
 * Notifica todos os webhooks ativos assinados no evento.
 *
 * É o único ponto de saída usado pelas operações do painel: cada serviço chama
 * esta função e não precisa saber quantos destinos existem nem como assinar o
 * corpo. Falhas nunca propagam — um destino fora do ar não pode derrubar a
 * criação de um lead ou de uma campanha.
 */
const DISPAROS_WEBHOOK_URL = process.env.N8N_DISPAROS_WEBHOOK_URL?.trim() || "https://n8n-www4kggggc4c8k8ow4w8g4g0.95.217.164.173.sslip.io/webhook/disparos"

/**
 * Agenda uma tarefa para depois da resposta usando `after`, mas com fallback.
 *
 * `after` só existe dentro de um escopo de requisição (server action, route
 * handler ou render). A engine de disparo, porém, roda em um timer de background
 * (`instrumentation.ts`, via setInterval), fora de qualquer requisição — e nesse
 * caso `after` lança "was called outside a request scope". Quando isso acontece,
 * executamos a tarefa diretamente em background (fire-and-forget), sem bloquear
 * o chamador e sem deixar o erro derrubar o envio da mensagem.
 */
function agendarEntrega(tarefa: () => Promise<void>): void {
  try {
    after(tarefa)
  } catch {
    void tarefa().catch((error) => {
      console.error("[v0] Falha ao executar entrega de webhook em background:", error)
    })
  }
}

export async function emitWebhookEvent(evento: string, dados: unknown): Promise<void> {
  /*
   * A entrega roda depois da resposta: o usuário não deve esperar o tempo de rede
   * de até cinco destinos externos para ver o lead salvo na tela.
   */
  agendarEntrega(async () => {
    let destinos: Array<{ id: string; url: string; secret: string }> = []
    try {
      destinos = await prisma.webhook.findMany({
        // `has` filtra no banco pela lista de eventos assinados do webhook.
        where: { ativo: true, eventos: { has: evento } },
        select: { id: true, url: true, secret: true },
      })
    } catch (error) {
      console.error("[v0] emitWebhookEvent não conseguiu carregar os webhooks:", error)
      return
    }

    if (destinos.length === 0) return

    // Em paralelo: um destino lento não deve atrasar a entrega nos demais.
    const entregas = await Promise.allSettled(destinos.map((destino) => enviar(destino, evento, dados)))
    entregas.forEach((entrega, indice) => {
      if (entrega.status === "rejected") {
        console.error(`[v0] Falha ao entregar ${evento} em ${destinos[indice].url}:`, entrega.reason)
      }
    })
  })
}

export async function emitDisparoWebhook(payload: Record<string, unknown>): Promise<void> {
  if (!DISPAROS_WEBHOOK_URL) return

  agendarEntrega(async () => {
    try {
      await fetch(DISPAROS_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (error) {
      console.error("[v0] Falha ao enviar para o webhook de disparos:", error)
    }
  })
}

async function enviar(
  webhook: { id: string; url: string; secret: string },
  evento: string,
  dados: unknown,
): Promise<WebhookEntrega> {
  const corpo = JSON.stringify({
    evento,
    enviadoEm: new Date().toISOString(),
    dados,
  })
  const assinatura = createHmac("sha256", webhook.secret).update(corpo).digest("hex")

  let status: number | null = null
  let detalhe = ""
  let ok = false

  try {
    // Sem timeout a requisição poderia pendurar a server action indefinidamente.
    const resposta = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Event": evento,
        "X-Webhook-Signature": `sha256=${assinatura}`,
      },
      body: corpo,
      signal: AbortSignal.timeout(10_000),
    })
    status = resposta.status
    ok = resposta.ok
    detalhe = ok ? `Resposta ${resposta.status}.` : `O destino respondeu ${resposta.status}.`
  } catch (error) {
    detalhe = error instanceof Error ? error.message : "Falha ao contatar o destino."
  }

  // O registro do último envio é informativo: se ele falhar, a entrega já ocorreu.
  try {
    await prisma.webhook.update({
      where: { id: webhook.id },
      data: { ultimoEnvioEm: new Date(), ultimoEnvioStatus: status },
    })
  } catch (error) {
    console.error("[v0] Não foi possível registrar o último envio:", error)
  }

  return { ok, status, detalhe }
}
