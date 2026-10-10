/**
 * Campanhas — coleção. Lista campanhas com estatísticas de desempenho (GET)
 * e cria uma nova campanha — padrão (sequência de mensagens) ou individual (texto por lead) — (POST).
 */
import { NextResponse } from "next/server"
import { createCampaign, listCampaigns, type CampaignInput } from "@/services/campaigns"
import type { CampaignStatus, CampaignTipo } from "@/types"
import { guardApi } from "@/lib/session"

const STATUS_VALIDOS: CampaignStatus[] = ["rascunho", "ativa", "pausada", "encerrada"]
const TIPOS_VALIDOS: CampaignTipo[] = ["padrao", "individual"]

export async function GET() {
  const bloqueio = await guardApi("campanhas")
  if (bloqueio) return bloqueio
  try {
    const campanhas = await listCampaigns()
    return NextResponse.json({ campanhas, total: campanhas.length })
  } catch (error) {
    console.error("[api/campanhas] GET", error)
    return NextResponse.json({ erro: "Falha ao listar campanhas." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const bloqueio = await guardApi("campanhas")
  if (bloqueio) return bloqueio
  let body: Partial<CampaignInput>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ erro: "Corpo da requisição inválido (JSON esperado)." }, { status: 400 })
  }

  if (!body.nome?.trim()) {
    return NextResponse.json({ erro: "O campo 'nome' é obrigatório." }, { status: 400 })
  }
  if (!body.status || !STATUS_VALIDOS.includes(body.status)) {
    return NextResponse.json(
      { erro: `O campo 'status' deve ser um de: ${STATUS_VALIDOS.join(", ")}.` },
      { status: 400 },
    )
  }
  if (!Array.isArray(body.mensagens)) {
    return NextResponse.json({ erro: "O campo 'mensagens' deve ser uma lista." }, { status: 400 })
  }
  if (body.tipo !== undefined && !TIPOS_VALIDOS.includes(body.tipo)) {
    return NextResponse.json(
      { erro: `O campo 'tipo' deve ser um de: ${TIPOS_VALIDOS.join(", ")}.` },
      { status: 400 },
    )
  }
  if (body.leadMensagens !== undefined && (typeof body.leadMensagens !== "object" || body.leadMensagens === null || Array.isArray(body.leadMensagens))) {
    return NextResponse.json({ erro: "O campo 'leadMensagens' deve ser um objeto { leadId: texto }." }, { status: 400 })
  }

  try {
    const campanha = await createCampaign({
      nome: body.nome.trim(),
      descricao: body.descricao,
      status: body.status,
      tipo: body.tipo ?? "padrao",
      recorrenciaDias: body.recorrenciaDias ?? 0,
      dataFinal: body.dataFinal ?? null,
      instanciaNome: body.instanciaNome ?? null,
      filtros: body.filtros ?? { produto: null, marca: null, persona: null, regiao: null },
      leadIds: body.leadIds,
      mensagens: body.mensagens,
      leadMensagens: body.leadMensagens,
    })
    return NextResponse.json({ campanha }, { status: 201 })
  } catch (error) {
    console.error("[api/campanhas] POST", error)
    return NextResponse.json({ erro: "Falha ao criar campanha." }, { status: 500 })
  }
}
