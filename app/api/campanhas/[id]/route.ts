/**
 * Campanhas — item. Detalha uma campanha com estatísticas (GET), atualiza a
 * campanha por completo (PUT), altera apenas o status (PATCH) e remove a
 * campanha e seus vínculos (DELETE).
 */
import { NextResponse } from "next/server"
import {
  deleteCampaign,
  getCampaign,
  setCampaignStatus,
  updateCampaign,
  type CampaignInput,
} from "@/services/campaigns"
import type { CampaignStatus } from "@/types"

const STATUS_VALIDOS: CampaignStatus[] = ["rascunho", "ativa", "pausada", "encerrada"]

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const campanha = await getCampaign(id)
    if (!campanha) {
      return NextResponse.json({ erro: "Campanha não encontrada." }, { status: 404 })
    }
    return NextResponse.json({ campanha })
  } catch (error) {
    console.error("[api/campanhas/:id] GET", error)
    return NextResponse.json({ erro: "Falha ao carregar campanha." }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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

  try {
    const campanha = await updateCampaign(id, {
      nome: body.nome.trim(),
      descricao: body.descricao,
      status: body.status,
      recorrenciaDias: body.recorrenciaDias ?? 0,
      dataFinal: body.dataFinal ?? null,
      filtros: body.filtros ?? { produto: null, marca: null, persona: null, regiao: null },
      leadIds: body.leadIds,
      mensagens: body.mensagens,
    })
    if (!campanha) {
      return NextResponse.json({ erro: "Campanha não encontrada." }, { status: 404 })
    }
    return NextResponse.json({ campanha })
  } catch (error) {
    console.error("[api/campanhas/:id] PUT", error)
    return NextResponse.json({ erro: "Falha ao atualizar campanha." }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { status?: CampaignStatus }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ erro: "Corpo da requisição inválido (JSON esperado)." }, { status: 400 })
  }

  if (!body.status || !STATUS_VALIDOS.includes(body.status)) {
    return NextResponse.json(
      { erro: `O campo 'status' deve ser um de: ${STATUS_VALIDOS.join(", ")}.` },
      { status: 400 },
    )
  }

  try {
    const campanha = await setCampaignStatus(id, body.status)
    if (!campanha) {
      return NextResponse.json({ erro: "Campanha não encontrada." }, { status: 404 })
    }
    return NextResponse.json({ campanha })
  } catch (error) {
    console.error("[api/campanhas/:id] PATCH", error)
    return NextResponse.json({ erro: "Falha ao alterar status da campanha." }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await deleteCampaign(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[api/campanhas/:id] DELETE", error)
    return NextResponse.json({ erro: "Falha ao remover campanha." }, { status: 500 })
  }
}
