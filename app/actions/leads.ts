"use server"

import { revalidatePath } from "next/cache"

import { assignCampaign, createLead, deleteLead, setLeadStatus, updateLead, type LeadInput } from "@/services/leads"
import { recordAppLog } from "@/services/app-logs"
import { MARCAS, PERSONAS, PRODUTOS, REGIOES, type LeadStatus } from "@/types"

export interface ActionState {
  ok: boolean
  message: string
  errors?: Record<string, string>
}

const STATUS_VALIDOS: LeadStatus[] = ["novo", "em_campanha", "respondeu", "qualificado", "encerrado"]

function parseLead(formData: FormData) {
  const errors: Record<string, string> = {}
  const nome = String(formData.get("nome") ?? "").trim()
  const telefone = String(formData.get("telefone") ?? "").trim()
  const produto = String(formData.get("produto") ?? "")
  const marca = String(formData.get("marca") ?? "")
  const persona = String(formData.get("persona") ?? "")
  const regiao = String(formData.get("regiao") ?? "")
  const status = String(formData.get("status") ?? "novo")
  const campanhasIdsRaw = String(formData.get("campanhasIds") ?? "")
  const campanhasIds = campanhasIdsRaw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)

  if (nome.length < 3) errors.nome = "Informe o nome completo do lead."
  if (telefone.replace(/\D/g, "").length < 10) errors.telefone = "Telefone precisa ter DDD e número."
  if (!PRODUTOS.includes(produto as never)) errors.produto = "Selecione um produto."
  if (!MARCAS.includes(marca as never)) errors.marca = "Selecione uma marca."
  if (!PERSONAS.includes(persona as never)) errors.persona = "Selecione uma persona."
  if (!REGIOES.includes(regiao as never)) errors.regiao = "Selecione uma região."

  const input: LeadInput = {
    nome,
    telefone,
    produto: produto as LeadInput["produto"],
    marca: marca as LeadInput["marca"],
    persona: persona as LeadInput["persona"],
    regiao: regiao as LeadInput["regiao"],
    status: (STATUS_VALIDOS.includes(status as LeadStatus) ? status : "novo") as LeadStatus,
    campanhaId: campanhasIds[0] ?? null,
    campanhasIds,
  }

  return { input, errors }
}

function revalidarLeads() {
  revalidatePath("/leads")
  revalidatePath("/dashboard")
  revalidatePath("/eventos")
  revalidatePath("/relatorios")
}

export async function createLeadAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { input, errors } = parseLead(formData)
  if (Object.keys(errors).length > 0) {
    return { ok: false, message: "Corrija os campos destacados.", errors }
  }
  try {
    await createLead(input)
  } catch (error) {
    await recordAppLog({ origem: "leads", mensagem: "Falha ao criar lead.", detalhes: error })
    return { ok: false, message: "Não foi possível salvar o lead. Verifique a conexão com o banco." }
  }
  revalidarLeads()
  return { ok: true, message: `Lead ${input.nome} cadastrado.` }
}

export async function updateLeadAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const id = String(formData.get("id") ?? "")
  const { input, errors } = parseLead(formData)
  if (Object.keys(errors).length > 0) {
    return { ok: false, message: "Corrija os campos destacados.", errors }
  }
  try {
    const atualizado = await updateLead(id, input)
    if (!atualizado) return { ok: false, message: "Lead não encontrado." }
  } catch (error) {
    await recordAppLog({ origem: "leads", mensagem: `Falha ao atualizar lead id=${id}.`, detalhes: error })
    return { ok: false, message: "Não foi possível atualizar o lead. Verifique a conexão com o banco." }
  }
  revalidarLeads()
  revalidatePath(`/leads/${id}`)
  return { ok: true, message: `Lead ${input.nome} atualizado.` }
}

export async function deleteLeadAction(id: string) {
  try {
    await deleteLead(id)
  } catch (error) {
    await recordAppLog({ origem: "leads", mensagem: `Falha ao excluir lead id=${id}.`, detalhes: error })
    return { ok: false, message: "Não foi possível excluir o lead." }
  }
  revalidarLeads()
  return { ok: true, message: "Lead excluído." }
}

export async function setLeadStatusAction(id: string, status: LeadStatus) {
  try {
    await setLeadStatus(id, status)
  } catch (error) {
    await recordAppLog({ origem: "leads", mensagem: `Falha ao atualizar status do lead id=${id} para "${status}".`, detalhes: error })
    return { ok: false, message: "Não foi possível atualizar o status." }
  }
  revalidarLeads()
  revalidatePath(`/leads/${id}`)
  return { ok: true, message: "Status atualizado." }
}

export async function assignCampaignAction(leadIds: string[], campanhaId: string | null) {
  try {
    for (const id of leadIds) await assignCampaign(id, campanhaId)
  } catch (error) {
    await recordAppLog({ origem: "leads", mensagem: `Falha ao mover ${leadIds.length} lead(s) de campanha.`, detalhes: error })
    return { ok: false, message: "Não foi possível mover os leads de campanha." }
  }
  revalidarLeads()
  return { ok: true, message: `${leadIds.length} lead(s) movidos de campanha.` }
}
