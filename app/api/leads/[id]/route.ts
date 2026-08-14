import { NextResponse } from "next/server"

import { deleteLead, getLead, getLeadTimeline, updateLead, type LeadInput } from "@/services/leads"
import { MARCAS, PERSONAS, PRODUTOS, REGIOES, type LeadStatus } from "@/types"

/**
 * Lead individual.
 *
 * GET    /api/leads/:id    Detalhe do lead + timeline de eventos.
 * PUT    /api/leads/:id    Atualiza os dados do lead.
 * DELETE /api/leads/:id    Remove o lead (eventos em cascata).
 *
 * Protegidas por sessão via proxy.ts. No Next 16 os `params` são assíncronos.
 */

const STATUS_VALIDOS: LeadStatus[] = ["novo", "em_campanha", "respondeu", "qualificado", "encerrado"]

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
  const produto = String(dados.produto ?? "")
  const marca = String(dados.marca ?? "")
  const persona = String(dados.persona ?? "")
  const regiao = String(dados.regiao ?? "")
  const statusBruto = String(dados.status ?? "novo")
  const campanhasIds = Array.isArray(dados.campanhasIds)
    ? dados.campanhasIds.map((cid) => String(cid).trim()).filter(Boolean)
    : []

  if (nome.length < 3) errors.nome = "Informe o nome completo do lead."
  if (telefone.replace(/\D/g, "").length < 10) errors.telefone = "Telefone precisa ter DDD e número."
  if (!PRODUTOS.includes(produto as never)) errors.produto = "Selecione um produto válido."
  if (!MARCAS.includes(marca as never)) errors.marca = "Selecione uma marca válida."
  if (!PERSONAS.includes(persona as never)) errors.persona = "Selecione uma persona válida."
  if (!REGIOES.includes(regiao as never)) errors.regiao = "Selecione uma região válida."

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ ok: false, erro: "Corrija os campos destacados.", errors }, { status: 400 })
  }

  const input: LeadInput = {
    nome,
    telefone,
    produto: produto as LeadInput["produto"],
    marca: marca as LeadInput["marca"],
    persona: persona as LeadInput["persona"],
    regiao: regiao as LeadInput["regiao"],
    status: (STATUS_VALIDOS.includes(statusBruto as LeadStatus) ? statusBruto : "novo") as LeadStatus,
    campanhaId: campanhasIds[0] ?? null,
    campanhasIds,
  }

  try {
    const lead = await updateLead(id, input)
    if (!lead) return NextResponse.json({ ok: false, erro: "Lead não encontrado." }, { status: 404 })
    return NextResponse.json({ ok: true, lead })
  } catch (error) {
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
