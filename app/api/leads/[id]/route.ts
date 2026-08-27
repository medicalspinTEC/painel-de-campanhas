import { NextResponse } from "next/server"

import { deleteLead, getLead, getLeadTimeline, LeadValidationError, updateLead, type LeadInput } from "@/services/leads"
import { validarTelefoneBR } from "@/lib/telefone"
import { type LeadStatus } from "@/types"

/**
 * Lead individual.
 *
 * GET    /api/leads/:id    Detalhe do lead + timeline de eventos.
 * PUT    /api/leads/:id    Atualiza os dados do lead.
 * DELETE /api/leads/:id    Remove o lead (eventos em cascata).
 *
 * Protegidas por sessão via proxy.ts. No Next 16 os `params` são assíncronos.
 */

const STATUS_VALIDOS: LeadStatus[] = ["novo", "em_campanha", "respondeu", "encerrado"]

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const lead = await getLead(id)
    if (!lead) return NextResponse.json({ ok: false, erro: "Lead não encontrado." }, { status: 404 })
    const timeline = await getLeadTimeline(id)
    return NextResponse.json({ ok: true, lead, timeline })
  } catch (error) {
    console.error(`[v0] GET /api/leads/${id} falhou:`, error)
    return NextResponse.json({ ok: false, erro: "Não foi possível carregar o lead." }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ ok: false, erro: "Corpo inválido: esperado JSON." }, { status: 400 })
  }

  const dados = corpo as Record<string, unknown>
  const errors: Record<string, string> = {}

  const nome = String(dados.nome ?? "").trim()
  const telefone = String(dados.telefone ?? "").trim()
  // Só validamos as dimensões de segmentação que vierem preenchidas no corpo.
  const produto = String(dados.produto ?? "").trim()
  const marca = String(dados.marca ?? "").trim()
  const persona = String(dados.persona ?? "").trim()
  const regiao = String(dados.regiao ?? "").trim()
  const statusBruto = String(dados.status ?? "novo")
  const campanhasIds = Array.isArray(dados.campanhasIds)
    ? dados.campanhasIds.map((cid) => String(cid).trim()).filter(Boolean)
    : []

  // Apenas nome e telefone são obrigatórios. As dimensões de segmentação
  // (produto, marca, persona, região) são cadastradas pelo usuário na aba de
  // Segmentação e aceitas como texto livre — não há mais lista fixa a validar.
  if (nome.length < 3) errors.nome = "Informe o nome completo do lead."
  // Telefone deve incluir o código do país 55 (ex.: 5551999999999). O DDD 55 do
  // RS com país vira 5555..., que é válido — a validação usa o total de dígitos.
  const resultadoTelefone = validarTelefoneBR(telefone)
  if (!resultadoTelefone.ok) errors.telefone = resultadoTelefone.erro ?? "Telefone inválido."

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ ok: false, erro: "Corrija os campos destacados.", errors }, { status: 400 })
  }

  const input: LeadInput = {
    nome,
    telefone,
    status: (STATUS_VALIDOS.includes(statusBruto as LeadStatus) ? statusBruto : "novo") as LeadStatus,
    campanhaId: campanhasIds[0] ?? null,
    campanhasIds,
    // Campos opcionais: só entram no update quando presentes no corpo, para não
    // apagar dados existentes em uma atualização parcial.
    ...("produto" in dados ? { produto: produto as LeadInput["produto"] } : {}),
    ...("marca" in dados ? { marca: marca as LeadInput["marca"] } : {}),
    ...("persona" in dados ? { persona: persona as LeadInput["persona"] } : {}),
    ...("regiao" in dados ? { regiao: regiao as LeadInput["regiao"] } : {}),
    ...("notas" in dados ? { notas: dados.notas != null ? String(dados.notas) : null } : {}),
  }

  try {
    const lead = await updateLead(id, input)
    if (!lead) return NextResponse.json({ ok: false, erro: "Lead não encontrado." }, { status: 404 })
    return NextResponse.json({ ok: true, lead })
  } catch (error) {
    if (error instanceof LeadValidationError) {
      return NextResponse.json(
        { ok: false, erro: "Corrija os campos destacados.", errors: error.errors },
        { status: 409 },
      )
    }
    console.error(`[v0] PUT /api/leads/${id} falhou:`, error)
    return NextResponse.json({ ok: false, erro: "Não foi possível atualizar o lead." }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const existente = await getLead(id)
    if (!existente) return NextResponse.json({ ok: false, erro: "Lead não encontrado." }, { status: 404 })
    await deleteLead(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error(`[v0] DELETE /api/leads/${id} falhou:`, error)
    return NextResponse.json({ ok: false, erro: "Não foi possível excluir o lead." }, { status: 500 })
  }
}
