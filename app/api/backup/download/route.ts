import { NextResponse } from "next/server"

import { guardApi } from "@/lib/session"
import { criarDownloadBackup } from "@/services/backup"

/**
 * Baixa o backup como arquivo .json, sem precisar de webhook.
 *
 * GET /api/backup/download?secoes=leads,campanhas
 * Mesmo acesso da página de Configurações.
 */
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const negado = await guardApi("configuracoes")
  if (negado) return negado

  const secoes = (new URL(request.url).searchParams.get("secoes") ?? "").split(",").filter(Boolean)

  try {
    const resultado = await criarDownloadBackup(secoes)
    if (!resultado.ok) return NextResponse.json({ ok: false, erro: resultado.erro }, { status: 400 })

    return new Response(resultado.stream, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${resultado.nome}"`,
        "cache-control": "no-store",
      },
    })
  } catch (error) {
    console.error("[v0] GET /api/backup/download falhou:", error)
    return NextResponse.json({ ok: false, erro: "Não foi possível gerar o backup." }, { status: 500 })
  }
}
