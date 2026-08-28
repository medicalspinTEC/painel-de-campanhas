"use server"

import { revalidatePath } from "next/cache"

import { assignCampaign, createLead, deleteLead, LeadValidationError, setLeadStatus, updateLead, updateLeadNotes, type LeadInput } from "@/services/leads"
import { listCampaigns } from "@/services/campaigns"
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

/** Linha de lead recebida de um arquivo Excel/CSV importado. */
export interface LeadImportRow {
  nome?: string
  telefone?: string
  produto?: string
  marca?: string
  persona?: string
  regiao?: string
  status?: string
  notas?: string
  /** Nome da campanha a vincular (opcional). Resolvido para ID no servidor. */
  campanha?: string
}

export interface ImportLeadsResult {
  ok: boolean
  message: string
  /** Total de linhas recebidas do arquivo. */
  total: number
  /** Leads efetivamente cadastrados. */
  criados: number
  /** Linhas que não puderam ser cadastradas, com o motivo. */
  erros: Array<{ linha: number; nome: string; motivo: string }>
}

/** Limite defensivo para uma única importação. */
const MAX_IMPORTACAO = 2000

/**
 * Cria em lote os leads recebidos de um arquivo importado. Cada linha passa
 * pela mesma validação e regras de negócio de `createLead` (telefone com país
 * 55, unicidade de nome/telefone, cadastro automático de segmentação e
 * vinculação a campanhas compatíveis). Erros por linha não interrompem o lote:
 * o resultado reporta quantos foram criados e o motivo de cada falha.
 */
export async function importLeadsAction(linhas: LeadImportRow[]): Promise<ImportLeadsResult> {
  if (!Array.isArray(linhas) || linhas.length === 0) {
    return { ok: false, message: "Nenhuma linha encontrada no arquivo.", total: 0, criados: 0, erros: [] }
  }
  if (linhas.length > MAX_IMPORTACAO) {
    return {
      ok: false,
      message: `O arquivo tem ${linhas.length} linhas. Importe no máximo ${MAX_IMPORTACAO} por vez.`,
      total: linhas.length,
      criados: 0,
      erros: [],
    }
  }

  // Mapa de nome de campanha (normalizado) -> id, para resolver a coluna
  // opcional "campanha" do arquivo. Buscamos uma única vez para o lote todo.
  const mapaCampanhas = new Map<string, string>()
  const precisaCampanhas = linhas.some((linha) => String(linha?.campanha ?? "").trim().length > 0)
  if (precisaCampanhas) {
    try {
      const campanhas = await listCampaigns()
      for (const campanha of campanhas) {
        mapaCampanhas.set(campanha.nome.trim().toLowerCase(), campanha.id)
      }
    } catch (error) {
      await recordAppLog({ origem: "leads", mensagem: "Falha ao carregar campanhas para importação de leads.", detalhes: error })
    }
  }

  const erros: ImportLeadsResult["erros"] = []
  let criados = 0

  for (let i = 0; i < linhas.length; i++) {
    // +2: linha 1 é o cabeçalho e o índice é base zero, então a primeira linha
    // de dados aparece como "linha 2" — igual ao número exibido na planilha.
    const numeroLinha = i + 2
    const bruto = linhas[i] ?? {}
    const nome = String(bruto.nome ?? "").trim()
    const telefone = String(bruto.telefone ?? "").trim()
    const produto = String(bruto.produto ?? "").trim()
    const marca = String(bruto.marca ?? "").trim()
    const persona = String(bruto.persona ?? "").trim()
    const regiao = String(bruto.regiao ?? "").trim()
    const notasBruta = String(bruto.notas ?? "").trim()
    const statusBruto = String(bruto.status ?? "").trim()
    const campanhaBruta = String(bruto.campanha ?? "").trim()

    if (nome.length < 3) {
      erros.push({ linha: numeroLinha, nome: nome || "(sem nome)", motivo: "Nome ausente ou muito curto." })
      continue
    }
    const resultadoTelefone = validarTelefoneBR(telefone)
    if (!resultadoTelefone.ok) {
      erros.push({ linha: numeroLinha, nome, motivo: resultadoTelefone.erro ?? "Telefone inválido." })
      continue
    }
    if ([produto, marca, persona, regiao].some((valor) => valor.length > MAX_SEGMENTO)) {
      erros.push({ linha: numeroLinha, nome, motivo: `Campos de segmentação devem ter até ${MAX_SEGMENTO} caracteres.` })
      continue
    }

    // A coluna "campanha" é opcional. Se preenchida, precisa casar (sem
    // diferenciar maiúsculas) com uma campanha existente pelo nome.
    let campanhaId: string | null = null
    if (campanhaBruta.length > 0) {
      const encontrada = mapaCampanhas.get(campanhaBruta.toLowerCase())
      if (!encontrada) {
        erros.push({ linha: numeroLinha, nome, motivo: `Campanha "${campanhaBruta}" não encontrada.` })
        continue
      }
      campanhaId = encontrada
    }

    const input: LeadInput = {
      nome,
      telefone,
      produto: produto as LeadInput["produto"],
      marca: marca as LeadInput["marca"],
      persona: persona as LeadInput["persona"],
      regiao: regiao as LeadInput["regiao"],
      notas: notasBruta.length > 0 ? notasBruta : null,
      status: (STATUS_VALIDOS.includes(statusBruto as LeadStatus) ? statusBruto : "novo") as LeadStatus,
      campanhaId,
      campanhasIds: campanhaId ? [campanhaId] : [],
    }

    try {
      await createLead(input)
      criados++
    } catch (error) {
      if (error instanceof LeadValidationError) {
        const motivo = Object.values(error.errors).join(" ") || "Dados inválidos."
        erros.push({ linha: numeroLinha, nome, motivo })
      } else {
        await recordAppLog({ origem: "leads", mensagem: `Falha ao importar lead "${nome}" (linha ${numeroLinha}).`, detalhes: error })
        erros.push({ linha: numeroLinha, nome, motivo: "Erro inesperado ao salvar. Verifique a conexão com o banco." })
      }
    }
  }

  if (criados > 0) revalidarLeads()

  const message =
    criados === 0
      ? "Nenhum lead foi importado. Revise os erros e tente novamente."
      : `${criados} lead(s) importado(s)${erros.length > 0 ? ` · ${erros.length} com erro` : ""}.`

  return { ok: criados > 0, message, total: linhas.length, criados, erros }
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
