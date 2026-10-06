import { createReadStream } from "node:fs"
import { stat, unlink } from "node:fs/promises"
import { Readable } from "node:stream"
import { NextResponse, type NextRequest } from "next/server"

import { caminhoDoArquivo, lerLinhaDeArquivo } from "@/lib/arquivo-storage"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Download de uma imagem/arquivo recebido de um lead (ver `lib/arquivo-storage.ts`).
 *
 * O app não mantém esses arquivos: assim que o download termina, o arquivo é APAGADO do servidor.
 * Se o download for interrompido no meio, o arquivo continua lá para uma nova tentativa. Exige
 * sessão e confere que o arquivo pertence a uma conversa da instância do usuário (a timeline é
 * filtrada por instância pelo `prisma`).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const usuario = await getCurrentUser()
  if (!usuario) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 })

  const caminho = caminhoDoArquivo(id)
  if (!caminho) return NextResponse.json({ ok: false, erro: "Arquivo inválido." }, { status: 400 })

  const evento = await prisma.timelineEvent.findFirst({
    where: { detalhes: { contains: `Arquivo: ${id};` } },
    select: { detalhes: true },
  })
  const meta = lerLinhaDeArquivo(evento?.detalhes)
  if (!evento || !meta || meta.id !== id) {
    return NextResponse.json({ ok: false, erro: "Arquivo não encontrado." }, { status: 404 })
  }

  let tamanho: number
  try {
    const info = await stat(caminho)
    if (!info.isFile()) throw new Error("não é arquivo")
    tamanho = info.size
  } catch {
    return NextResponse.json({ ok: false, erro: "Este arquivo já foi baixado ou expirou e foi removido do servidor." }, { status: 404 })
  }

  const leitura = createReadStream(caminho)
  // Só apaga quando o arquivo foi lido até o fim (download completo); se o cliente abortar, fica.
  leitura.on("end", () => void unlink(caminho).catch(() => undefined))

  const nomeAscii = meta.nome.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  return new NextResponse(Readable.toWeb(leitura) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": meta.mime || "application/octet-stream",
      "Content-Length": String(tamanho),
      "Content-Disposition": `attachment; filename="${nomeAscii}"; filename*=UTF-8''${encodeURIComponent(meta.nome)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
