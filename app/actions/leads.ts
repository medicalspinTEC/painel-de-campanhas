"use server"

import { revalidatePath } from "next/cache"

import { assignCampaign, createLead, deleteLead, LeadValidationError, setLeadStatus, updateLead, updateLeadNotes, type LeadInput } from "@/services/leads"
import { recordAppLog } from "@/services/app-logs"
import { validarTelefoneBR } from "@/lib/telefone"
import { type LeadStatus } from "@/types"

export interface ActionState {
  ok: boolean
  message: string
  errors?: Record<string, string>
}

const STATUS_VALIDOS: LeadStatus[] = ["novo", "em_campanha", "respondeu", "encerrado"]

/** Tamanho máximo para as dimensões de segmentação (texto livre). */
const MAX_SEGMENTO = 60

function parseLead(formData: FormData) {
  const errors: Record<string, string> = {}
  const nome = String(formData.get("nome") ?? "").trim()
  const telefone = String(formData.get("telefone") ?? "").trim()
  // Segmentação é opcional: só validamos os campos que vierem preenchidos.
  const produto = String(formData.get("produto") ?? "").trim()
  const marca = String(formData.get("marca") ?? "").trim()
  const persona = String(formData.get("persona") ?? "").trim()
  const regiao = String(formData.get("regiao") ?? "").trim()
  const notas = formData.has("notas") ? String(formData.get("notas") ?? "") : null
  const status = String(formData.get("status") ?? "novo")
  const campanhasIdsRaw = String(formData.get("campanhasIds") ?? "")
  const campanhasIds = campanhasIdsRaw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)

  // Apenas nome e telefone são obrigatórios.
  if (nome.length < 3) errors.nome = "Informe o nome completo do lead."
  // Telefone deve incluir o código do país 55 antes do DDD (ex.: 5551999999999).
  // Cuidado: DDD 55 (RS) COM país fica 5555..., o que é válido — a validação
  // considera o total de dígitos, não a presença da sequência "55".
  const resultadoTelefone = validarTelefoneBR(telefone)
  if (!resultadoTelefone.ok) errors.telefone = resultadoTelefone.erro ?? "Telefone inválido."
  // Segmentação é texto livre: além dos valores padrão, a equipe pode adicionar
  // novos itens pelo formulário. Validamos apenas o tamanho máximo.
  if (produto.length > MAX_SEGMENTO) errors.produto = `Use no máximo ${MAX_SEGMENTO} caracteres.`
  if (marca.length > MAX_SEGMENTO) errors.marca = `Use no máximo ${MAX_SEGMENTO} caracteres.`
  if (persona.length > MAX_SEGMENTO) errors.persona = `Use no máximo ${MAX_SEGMENTO} caracteres.`
  if (regiao.length > MAX_SEGMENTO) errors.regiao = `Use no máximo ${MAX_SEGMENTO} caracteres.`
  if (notas != null && notas.length > 5000) errors.notas = "As notas são muito longas (máximo de 5000 caracteres)."

  const input: LeadInput = {
    nome,
    telefone,
    produto: produto as LeadInput["produto"],
    marca: marca as LeadInput["marca"],
    persona: persona as LeadInput["persona"],
    regiao: regiao as LeadInput["regiao"],
    notas,
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
    if (error instanceof LeadValidationError) {
      return { ok: false, message: "Corrija os campos destacados.", errors: error.errors }
    }
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
    if (error instanceof LeadValidationError) {
      return { ok: false, message: "Corrija os campos destacados.", errors: error.errors }
    }
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

export async function updateLeadNotesAction(id: string, notas: string) {
  if (notas.length > 5000) {
    return { ok: false, message: "As notas são muito longas (máximo de 5000 caracteres)." }
  }
  try {
    const atualizado = await updateLeadNotes(id, notas)
    if (!atualizado) return { ok: false, message: "Lead não encontrado." }
  } catch (error) {
    await recordAppLog({ origem: "leads", mensagem: `Falha ao atualizar notas do lead id=${id}.`, detalhes: error })
    return { ok: false, message: "Não foi possível salvar as notas. Verifique a conexão com o banco." }
  }
  revalidatePath(`/leads/${id}`)
  return { ok: true, message: "Notas salvas." }
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
