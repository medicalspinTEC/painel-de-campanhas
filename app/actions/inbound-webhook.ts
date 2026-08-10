"use server"

import { revalidatePath } from "next/cache"
import { gerarToken, toggleToken, limparEventos } from "@/services/inbound-webhook"
import { recordAppLog } from "@/services/app-logs"

export type InboundAction = { ok: boolean; message: string }

export async function gerarTokenAction(): Promise<InboundAction & { token?: string }> {
  try {
    const token = await gerarToken()
    revalidatePath("/integracoes")
    return { ok: true, message: "Token gerado com sucesso.", token }
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "inbound-webhook",
      mensagem: "Falha ao gerar token do webhook de entrada.",
      detalhes: error,
    })
    return { ok: false, message: "Não foi possível gerar o token." }
  }
}

export async function toggleTokenAction(ativo: boolean): Promise<InboundAction> {
  try {
    await toggleToken(ativo)
    revalidatePath("/integracoes")
    return { ok: true, message: ativo ? "Webhook de entrada ativado." : "Webhook de entrada desativado." }
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "inbound-webhook",
      mensagem: "Falha ao alterar status do token.",
      detalhes: error,
    })
    return { ok: false, message: "Não foi possível alterar o status." }
  }
}

export async function limparEventosAction(): Promise<InboundAction> {
  try {
    const count = await limparEventos()
    revalidatePath("/integracoes")
    return { ok: true, message: `${count} evento${count !== 1 ? "s" : ""} removido${count !== 1 ? "s" : ""}.` }
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "inbound-webhook",
      mensagem: "Falha ao limpar eventos do webhook de entrada.",
      detalhes: error,
    })
    return { ok: false, message: "Não foi possível limpar os eventos." }
  }
}
