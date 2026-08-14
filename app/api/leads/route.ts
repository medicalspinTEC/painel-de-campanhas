import { NextResponse } from "next/server"

import { createLead, listLeads, type LeadInput } from "@/services/leads"
import { MARCAS, PERSONAS, PRODUTOS, REGIOES, type LeadStatus } from "@/types"

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

  // Apenas nome e telefone são obrigatórios.
  if (nome.length < 3) errors.nome = "Informe o nome completo do lead."
  if (telefone.replace(/\D/g, "").length < 10) errors.telefone = "Telefone precisa ter DDD e número."
  if (produto && !PRODUTOS.includes(produto as never)) errors.produto = "Selecione um produto válido."
  if (marca && !MARCAS.includes(marca as never)) errors.marca = "Selecione uma marca válida."
  if (persona && !PERSONAS.includes(persona as never)) errors.persona = "Selecione uma persona válida."
  if (regiao && !REGIOES.includes(regiao as never)) errors.regiao = "Selecione uma região válida."

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
    console.error("[v0] POST /api/leads falhou:", error)
    return NextResponse.json({ ok: false, erro: "Não foi possível criar o lead." }, { status: 500 })
  }
}
