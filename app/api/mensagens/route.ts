/**
 * Mensagens — registro de eventos. A engine de disparo reporta cada
 * acontecimento de mensagem aqui (POST): enviada, falha, resposta ou agendada.
 * Grava o evento na timeline do lead e notifica os webhooks assinados.
 */
import { NextResponse } from "next/server"
import { recordMessageEvent, type MessageEventInput, type MessageEventKind } from "@/services/message-events"

const KINDS_VALIDOS: MessageEventKind[] = ["enviada", "falha", "resposta", "agendada"]

export async function POST(request: Request) {
  let body: Partial<MessageEventInput>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ erro: "Corpo da requisição inválido (JSON esperado)." }, { status: 400 })
  }

  if (!body.kind || !KINDS_VALIDOS.includes(body.kind)) {
    return NextResponse.json(
      { erro: `O campo 'kind' deve ser um de: ${KINDS_VALIDOS.join(", ")}.` },
      { status: 400 },
    )
  }
  if (!body.leadId?.trim()) {
    return NextResponse.json({ erro: "O campo 'leadId' é obrigatório." }, { status: 400 })
  }

  try {
    const resultado = await recordMessageEvent({
      kind: body.kind,
      leadId: body.leadId.trim(),
      campanhaId: body.campanhaId ?? null,
      mensagemId: body.mensagemId ?? null,
      descricao: body.descricao,
      detalhes: body.detalhes ?? null,
      agendadoPara: body.agendadoPara ?? null,
    })
    if (!resultado.ok) {
      return NextResponse.json({ erro: resultado.erro ?? "Não foi possível registrar o evento." }, { status: 404 })
    }
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (error) {
    console.error("[api/mensagens] POST", error)
    return NextResponse.json({ erro: "Falha ao registrar evento de mensagem." }, { status: 500 })
  }
}
