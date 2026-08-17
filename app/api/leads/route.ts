import { NextResponse } from "next/server"

import { createLead, LeadValidationError, listLeads, type LeadInput } from "@/services/leads"
import { validarTelefoneBR } from "@/lib/telefone"
import { type LeadStatus } from "@/types"

/**
 * Coleção de leads.
 *
 * GET  /api/leads          Lista todos os leads (com agregações de mensagens/respostas).
 * POST /api/leads          Cria um novo lead a partir de um corpo JSON.
 *
 * Ambas exigem sessão — o proxy.ts bloqueia o acesso sem cookie autenticado, da
 * mesma forma que as páginas do painel.
 */

const STATUS_VALIDOS: LeadStatus[] = ["novo", "em_campanha", "respondeu", "qualificado", "encerrado"]

export async function GET() {
  try {
    const leads = await listLeads()
    return NextResponse.json({ ok: true, total: leads.length, leads })
  } catch (error) {
    console.error("[v0] GET /api/leads falhou:", error)
    return NextResponse.json({ ok: false, erro: "Não foi possível listar os leads." }, { status: 500 })
  }
}

export async function POST(request: Request) {
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
  // Campos de segmentação são opcionais: só validamos os que vierem preenchidos.
  const produto = String(dados.produto ?? "").trim()
  const marca = String(dados.marca ?? "").trim()
  const persona = String(dados.persona ?? "").trim()
  const regiao = String(dados.regiao ?? "").trim()
  const notas = dados.notas != null ? String(dados.notas) : null
  const statusBruto = String(dados.status ?? "novo")
  const campanhasIds = Array.isArray(dados.campanhasIds)
    ? dados.campanhasIds.map((id) => String(id).trim()).filter(Boolean)
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
    produto: produto as LeadInput["produto"],
    marca: marca as LeadInput["marca"],
    persona: persona as LeadInput["persona"],
    regiao: regiao as LeadInput["regiao"],
    notas,
    status: (STATUS_VALIDOS.includes(statusBruto as LeadStatus) ? statusBruto : "novo") as LeadStatus,
    campanhaId: campanhasIds[0] ?? null,
    campanhasIds,
  }

  try {
    const lead = await createLead(input)
    return NextResponse.json({ ok: true, lead }, { status: 201 })
  } catch (error) {
    if (error instanceof LeadValidationError) {
      return NextResponse.json(
        { ok: false, erro: "Corrija os campos destacados.", errors: error.errors },
        { status: 409 },
      )
    }
    console.error("[v0] POST /api/leads falhou:", error)
    return NextResponse.json({ ok: false, erro: "Não foi possível criar o lead." }, { status: 500 })
  }
}
