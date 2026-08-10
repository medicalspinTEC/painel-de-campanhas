import { NextResponse } from "next/server"
import { receberEvento } from "@/services/inbound-webhook"

/**
 * Endpoint público para receber eventos de sistemas externos.
 *
 * POST /api/webhook/entrada
 * Headers:
 *   x-webhook-token: <token gerado no painel>
 *   Content-Type: application/json
 *
 * Body:
 * {
 *   "evento": "nome.do.evento",   // obrigatório — identifica o tipo do evento
 *   "dados": { ... }               // opcional — payload livre do sistema externo
 * }
 */
export async function POST(request: Request) {
  const token = request.headers.get("x-webhook-token")?.trim()
  if (!token) {
    return NextResponse.json(
      { ok: false, erro: "Header x-webhook-token ausente." },
      { status: 401 },
    )
  }

  let corpo: unknown
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ ok: false, erro: "Corpo inválido: esperado JSON." }, { status: 400 })
  }

  const dados = corpo as Record<string, unknown>
  const evento = String(dados.evento ?? "").trim()

  if (!evento) {
    return NextResponse.json(
      { ok: false, erro: 'Campo "evento" é obrigatório.' },
      { status: 400 },
    )
  }

  // Captura o IP/origem para fins de auditoria.
  const origem =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null

  const payload = typeof dados.dados !== "undefined" ? dados.dados : corpo

  const aceito = await receberEvento(token, evento, payload, origem)

  if (!aceito) {
    return NextResponse.json(
      { ok: false, erro: "Token inválido ou webhook desativado." },
      { status: 401 },
    )
  }

  return NextResponse.json({ ok: true, mensagem: "Evento recebido." }, { status: 200 })
}
