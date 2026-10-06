import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { Readable } from "node:stream"
import { NextResponse, type NextRequest } from "next/server"

import { caminhoDoAudio, mimeDoAudio } from "@/lib/audio-storage"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Entrega a mensagem de voz guardada no servidor (ver `lib/audio-storage.ts`).
 *
 * Exige sessão e confere que o áudio pertence a uma conversa da instância do usuário
 * (a timeline é filtrada por instância pelo `prisma`). Aceita `Range` para o player
 * poder avançar/voltar no áudio. Depois do período de retenção o arquivo some: 404.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const usuario = await getCurrentUser()
  if (!usuario) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 })

  const caminho = caminhoDoAudio(id)
  if (!caminho) return NextResponse.json({ ok: false, erro: "Áudio inválido." }, { status: 400 })

  const evento = await prisma.timelineEvent.findFirst({
    where: { detalhes: { contains: `Audio: ${id}` } },
    select: { id: true },
  })
  if (!evento) return NextResponse.json({ ok: false, erro: "Áudio não encontrado." }, { status: 404 })

  let tamanho: number
  try {
    const info = await stat(caminho)
    if (!info.isFile()) throw new Error("não é arquivo")
    tamanho = info.size
  } catch {
    return NextResponse.json({ ok: false, erro: "Este áudio expirou e foi removido do servidor." }, { status: 404 })
  }

  const cabecalhos: Record<string, string> = {
    "Content-Type": mimeDoAudio(id),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  }

  const faixa = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "")
  if (faixa && (faixa[1] || faixa[2])) {
    let inicio = faixa[1] ? Number(faixa[1]) : tamanho - Number(faixa[2])
    let fim = faixa[1] && faixa[2] ? Number(faixa[2]) : tamanho - 1
    inicio = Math.max(0, inicio)
    fim = Math.min(fim, tamanho - 1)
    if (inicio > fim || inicio >= tamanho) {
      return new NextResponse(null, { status: 416, headers: { ...cabecalhos, "Content-Range": `bytes */${tamanho}` } })
    }
    const corpo = Readable.toWeb(createReadStream(caminho, { start: inicio, end: fim })) as ReadableStream
    return new NextResponse(corpo, {
      status: 206,
      headers: {
        ...cabecalhos,
        "Content-Range": `bytes ${inicio}-${fim}/${tamanho}`,
        "Content-Length": String(fim - inicio + 1),
      },
    })
  }

  const corpo = Readable.toWeb(createReadStream(caminho)) as ReadableStream
  return new NextResponse(corpo, { status: 200, headers: { ...cabecalhos, "Content-Length": String(tamanho) } })
}
