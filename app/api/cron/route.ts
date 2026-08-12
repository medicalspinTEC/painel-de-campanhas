import { NextResponse } from "next/server"

import { processDueMessages } from "@/services/campaign-engine"

/**
 * Aciona a engine de disparo sob demanda.
 *
 * GET/POST /api/cron
 * Útil para agendadores externos (cron-job.org, GitHub Actions, Vercel Cron) ou
 * para forçar um processamento manual. Quando `CRON_TOKEN` está definido, o
 * token é exigido via header `x-cron-token` ou query `?token=`.
 */
export const dynamic = "force-dynamic"

async function handle(request: Request) {
  const esperado = process.env.CRON_TOKEN
  if (esperado) {
    const recebido =
      request.headers.get("x-cron-token") ?? new URL(request.url).searchParams.get("token")
    if (recebido !== esperado) {
      return NextResponse.json({ ok: false, erro: "Token inválido." }, { status: 401 })
    }
  }

  try {
    const resultado = await processDueMessages()
    return NextResponse.json({ ok: true, ...resultado })
  } catch (error) {
    console.error("[v0] GET/POST /api/cron falhou:", error)
    return NextResponse.json({ ok: false, erro: "Falha ao processar a engine." }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
