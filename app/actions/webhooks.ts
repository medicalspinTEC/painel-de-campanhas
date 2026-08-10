"use server"

import { revalidatePath } from "next/cache"

import { WEBHOOK_EVENT_KEYS, WEBHOOK_LIMITE } from "@/lib/webhook-events"
import {
  createWebhook,
  deleteWebhook,
  dispatchWebhook,
  updateWebhook,
  WebhookLimiteError,
  type WebhookInput,
} from "@/services/webhooks"
import { recordAppLog } from "@/services/app-logs"

export type WebhookActionResult = { ok: boolean; message: string }

const CHAVES_VALIDAS = new Set(WEBHOOK_EVENT_KEYS)

function validar(input: WebhookInput): { erro: string } | { dados: WebhookInput } {
  const nome = input.nome.trim()
  if (!nome) return { erro: "Informe um nome para identificar o webhook." }

  const url = input.url.trim()
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { erro: "Informe uma URL válida, começando com https://" }
  }
  if (parsed.protocol !== "https:") return { erro: "A URL precisa usar https." }

  const eventos = Array.from(new Set(input.eventos)).filter((chave) => CHAVES_VALIDAS.has(chave))
  if (eventos.length === 0) return { erro: "Selecione ao menos um evento." }

  return { dados: { nome, url, eventos, ativo: input.ativo } }
}

export async function createWebhookAction(input: WebhookInput): Promise<WebhookActionResult> {
  const validado = validar(input)
  if ("erro" in validado) return { ok: false, message: validado.erro }

  try {
    await createWebhook(validado.dados)
  } catch (error) {
    if (error instanceof WebhookLimiteError) {
      return { ok: false, message: `Você já tem ${WEBHOOK_LIMITE} webhooks. Remova um para adicionar outro.` }
    }
    await recordAppLog({ origem: "webhooks", mensagem: "Falha ao criar webhook.", detalhes: error })
    return { ok: false, message: "Não foi possível criar o webhook." }
  }

  revalidatePath("/integracoes")
  return { ok: true, message: "Webhook criado." }
}

export async function updateWebhookAction(id: string, input: WebhookInput): Promise<WebhookActionResult> {
  const validado = validar(input)
  if ("erro" in validado) return { ok: false, message: validado.erro }

  try {
    await updateWebhook(id, validado.dados)
  } catch (error) {
    await recordAppLog({ origem: "webhooks", mensagem: `Falha ao atualizar webhook id=${id}.`, detalhes: error })
    return { ok: false, message: "Não foi possível salvar o webhook." }
  }

  revalidatePath("/integracoes")
  return { ok: true, message: "Webhook atualizado." }
}

export async function deleteWebhookAction(id: string): Promise<WebhookActionResult> {
  try {
    await deleteWebhook(id)
  } catch (error) {
    await recordAppLog({ origem: "webhooks", mensagem: `Falha ao remover webhook id=${id}.`, detalhes: error })
    return { ok: false, message: "Não foi possível remover o webhook." }
  }

  revalidatePath("/integracoes")
  return { ok: true, message: "Webhook removido." }
}

export async function testWebhookAction(id: string): Promise<WebhookActionResult> {
  try {
    const entrega = await dispatchWebhook(id, "webhook.teste", {
      mensagem: "Disparo de teste enviado pelo painel.",
    })
    if (!entrega.ok) {
      await recordAppLog({
        nivel: "aviso",
        origem: "webhooks",
        mensagem: `Teste do webhook id=${id} não entregue.`,
        detalhes: entrega.detalhe,
      })
    }
    revalidatePath("/integracoes")
    return {
      ok: entrega.ok,
      message: entrega.ok ? `Teste entregue. ${entrega.detalhe}` : `Teste não entregue. ${entrega.detalhe}`,
    }
  } catch (error) {
    await recordAppLog({ origem: "webhooks", mensagem: `Exceção ao testar webhook id=${id}.`, detalhes: error })
    return { ok: false, message: "Não foi possível executar o teste." }
  }
}
