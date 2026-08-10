import { NextResponse } from "next/server"

import { recordMessageEvent, type MessageEventKind } from "@/services/message-events"

/**
 * Entrada de eventos de mensagem da engine de disparo.
 *
 * POST /api/eventos
 * { "kind": "enviada" | "falha" | "resposta" | "agendada", "leadId": "...", ... }
 *
 * Cada chamada grava o evento na timeline do lead e notifica os webhooks
 * assinados no evento correspondente.
 */
const KINDS: MessageEventKind[] = ["enviada", "falha", "resposta", "agendada"]

export async function POST(request: Request) {
  /*
   * Quando INGEST_TOKEN está definido, a rota exige o token no header — é o que
   * impede terceiros de escrever na timeline em produção.
   */
  const esperado = process.env.INGEST_TOKEN
  if (esperado && request.headers.get("x-ingest-token") !== esperado) {
    return NextResponse.json({ ok: false, erro: "Token inválido." }, { status: 401 })
  }

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ ok: false, erro: "Corpo inválido: esperado JSON." }, { status: 400 })
  }

  const dados = corpo as Record<string, unknown>
  const kind = String(dados.kind ?? "") as MessageEventKind
  const leadId = String(dados.leadId ?? "").trim()

  if (!KINDS.includes(kind)) {
    return NextResponse.json({ ok: false, erro: `kind deve ser um de: ${KINDS.join(", ")}.` }, { status: 400 })
  }
  if (!leadId) {
    return NextResponse.json({ ok: false, erro: "Informe o leadId." }, { status: 400 })
  }

  try {
    const resultado = await recordMessageEvent({
      kind,
      leadId,
      campanhaId: typeof dados.campanhaId === "string" ? dados.campanhaId : null,
      mensagemId: typeof dados.mensagemId === "string" ? dados.mensagemId : null,
      descricao: typeof dados.descricao === "string" ? dados.descricao : undefined,
      detalhes: typeof dados.detalhes === "string" ? dados.detalhes : null,
      agendadoPara: typeof dados.agendadoPara === "string" ? dados.agendadoPara : null,
    })
    if (!resultado.ok) return NextResponse.json(resultado, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[v0] POST /api/eventos falhou:", error)
    return NextResponse.json({ ok: false, erro: "Não foi possível registrar o evento." }, { status: 500 })
  }
}
