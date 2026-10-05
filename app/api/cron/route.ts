import { NextResponse } from "next/server"

import { manutencaoBackup } from "@/services/backup"
import { processDueMessages } from "@/services/campaign-engine"
import { manutencaoNoCode } from "@/services/nocode-webhook-execucoes"

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
    // O cron é do sistema todo: percorre todas as instâncias ativas.
    const resultado = await processDueMessages(new Date(), { todasInstancias: true })
    // Poda as execuções com mais de 24h e reenvia ao webhook as que falharam (não derruba a engine se falhar).
    const nocode = await manutencaoNoCode().catch((error) => {
      console.error("[v0] manutenção do No Code falhou:", error)
      return null
    })
    // Dispara o backup automático se já chegou a hora (e repete os que falharam).
    const backup = await manutencaoBackup().catch((error) => {
      console.error("[v0] rotina de backup falhou:", error)
      return null
    })
    return NextResponse.json({
      ok: true,
      ...resultado,
      ...(nocode ? { nocode } : {}),
      ...(backup ? { backup } : {}),
    })
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
