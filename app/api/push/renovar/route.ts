import { NextResponse } from "next/server"

import { endpointPushValido } from "@/lib/push"
import { getCurrentUser } from "@/lib/session"
import { renovarAssinatura } from "@/services/push"

/**
 * Chamada pelo service worker (evento `pushsubscriptionchange`) quando o navegador troca o
 * endereço de push do aparelho. Usa o cookie de sessão: sem login, não registra nada.
 *
 * POST /api/push/renovar  { antigo: string | null, assinatura: PushSubscriptionJSON }
 */
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const usuario = await getCurrentUser()
  if (!usuario) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 })

  const corpo = (await request.json().catch(() => null)) as {
    antigo?: unknown
    assinatura?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
  } | null

  const nova = corpo?.assinatura
  if (
    !nova ||
    !endpointPushValido(nova.endpoint) ||
    typeof nova.keys?.p256dh !== "string" ||
    typeof nova.keys?.auth !== "string"
  ) {
    return NextResponse.json({ ok: false, erro: "Assinatura inválida." }, { status: 400 })
  }

  try {
    await renovarAssinatura(
      usuario.id,
      typeof corpo?.antigo === "string" ? corpo.antigo : null,
      { endpoint: nova.endpoint, p256dh: nova.keys.p256dh, auth: nova.keys.auth },
      { userAgent: request.headers.get("user-agent"), instalado: true },
    )
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[v0] POST /api/push/renovar falhou:", error)
    return NextResponse.json({ ok: false, erro: "Não foi possível renovar a assinatura." }, { status: 500 })
  }
}
