"use server"

import { revalidatePath } from "next/cache"

import {
  createCampaign,
  deleteCampaign,
  duplicateCampaign,
  setCampaignStatus,
  skipToNextMessage,
  updateCampaign,
  type CampaignInput,
} from "@/services/campaigns"
import { recordAppLog } from "@/services/app-logs"
import type { CampaignStatus } from "@/types"

export interface CampaignActionResult {
  ok: boolean
  message: string
  id?: string
  errors?: Record<string, string>
}

function revalidar(id?: string) {
  revalidatePath("/campanhas")
  revalidatePath("/dashboard")
  revalidatePath("/leads")
  revalidatePath("/relatorios")
  if (id) revalidatePath(`/campanhas/${id}`)
}

function validar(input: CampaignInput) {
  const errors: Record<string, string> = {}
  if (input.nome.trim().length < 3) errors.nome = "Dê um nome com pelo menos 3 caracteres."
  if (input.recorrenciaDias < 1) errors.recorrenciaDias = "A recorrência mínima é de 1 dia."
  if (input.mensagens.length === 0) errors.mensagens = "Adicione pelo menos uma mensagem na sequência."
  if (input.mensagens.some((m) => m.texto.trim().length < 10))
    errors.mensagens = "Todas as mensagens precisam ter no mínimo 10 caracteres."
  return errors
}

export async function createCampaignAction(input: CampaignInput): Promise<CampaignActionResult> {
  const errors = validar(input)
  if (Object.keys(errors).length > 0) return { ok: false, message: "Corrija os campos destacados.", errors }
  try {
    const campanha = await createCampaign(input)
    revalidar(campanha.id)
    return { ok: true, message: `Campanha ${campanha.nome} criada.`, id: campanha.id }
  } catch (error) {
    await recordAppLog({ origem: "campaigns", mensagem: "Falha ao criar campanha.", detalhes: error })
    return { ok: false, message: "Não foi possível criar a campanha. Verifique a conexão com o banco." }
  }
}

export async function updateCampaignAction(id: string, input: CampaignInput): Promise<CampaignActionResult> {
  const errors = validar(input)
  if (Object.keys(errors).length > 0) return { ok: false, message: "Corrija os campos destacados.", errors }
  try {
    const campanha = await updateCampaign(id, input)
    if (!campanha) return { ok: false, message: "Campanha não encontrada." }
    revalidar(id)
    return { ok: true, message: `Campanha ${campanha.nome} atualizada.`, id }
  } catch (error) {
    await recordAppLog({ origem: "campaigns", mensagem: `Falha ao atualizar campanha id=${id}.`, detalhes: error })
    return { ok: false, message: "Não foi possível atualizar a campanha." }
  }
}

export async function setCampaignStatusAction(id: string, status: CampaignStatus): Promise<CampaignActionResult> {
  try {
    const campanha = await setCampaignStatus(id, status)
    if (!campanha) return { ok: false, message: "Campanha não encontrada." }
    revalidar(id)
    return { ok: true, message: `Campanha ${campanha.nome} agora está ${status}.` }
  } catch (error) {
    await recordAppLog({ origem: "campaigns", mensagem: `Falha ao mudar status da campanha id=${id} para "${status}".`, detalhes: error })
    return { ok: false, message: "Não foi possível alterar o status da campanha." }
  }
}

export interface SkipMessageActionResult {
  ok: boolean
  message: string
  aguardandoRecorrencia?: boolean
}

export async function skipCampaignMessageAction(
  leadId: string,
  campanhaId: string,
): Promise<SkipMessageActionResult> {
  try {
    const resultado = await skipToNextMessage(leadId, campanhaId)
    if (resultado.ok) {
      revalidar(campanhaId)
      revalidatePath(`/leads/${leadId}`)
    }
    return { ok: resultado.ok, message: resultado.message, aguardandoRecorrencia: resultado.aguardandoRecorrencia }
  } catch (error) {
    await recordAppLog({
      origem: "campaigns",
      mensagem: `Falha ao pular mensagem do lead ${leadId} na campanha ${campanhaId}.`,
      detalhes: error,
    })
    return { ok: false, message: "Não foi possível enviar a próxima mensagem." }
  }
}

export async function duplicateCampaignAction(id: string): Promise<CampaignActionResult> {
  try {
    const copia = await duplicateCampaign(id)
    if (!copia) return { ok: false, message: "Campanha não encontrada." }
    revalidar()
    return { ok: true, message: `Campanha duplicada como rascunho.`, id: copia.id }
  } catch (error) {
    await recordAppLog({ origem: "campaigns", mensagem: `Falha ao duplicar campanha id=${id}.`, detalhes: error })
    return { ok: false, message: "Não foi possível duplicar a campanha." }
  }
}

export async function deleteCampaignAction(id: string): Promise<CampaignActionResult> {
  try {
    await deleteCampaign(id)
  } catch (error) {
    await recordAppLog({ origem: "campaigns", mensagem: `Falha ao excluir campanha id=${id}.`, detalhes: error })
    return { ok: false, message: "Não foi possível excluir a campanha." }
  }
  revalidar()
  return { ok: true, message: "Campanha excluída e leads liberados." }
}
