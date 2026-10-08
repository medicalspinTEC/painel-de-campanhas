import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { Readable } from "node:stream"
import { NextResponse, type NextRequest } from "next/server"

import { caminhoDoAnexoInterno } from "@/lib/interno-storage"
import { guardApi, getCurrentUser } from "@/lib/session"
import { runInWorkspace } from "@/lib/workspace-context"
import { concluirDownloadInterno, prepararDownloadInterno } from "@/services/chat-interno"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Download de uma imagem/arquivo do chat interno (ver `lib/interno-storage.ts`).
 *
 * O conteúdo não fica no banco: assim que TODOS os outros participantes da conversa baixam, o arquivo
 * é apagado do servidor. Download interrompido não conta (o arquivo continua para nova tentativa).
 * Só participantes da conversa baixam. O autor pode baixar o próprio envio sem afetar a exclusão.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Rota de sessão: o token estático de API não tem "usuário", então não vale aqui.
  const bloqueio = await guardApi("chat")
  if (bloqueio) return bloqueio
  const usuario = await getCurrentUser()
  if (!usuario) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 })

  const caminho = caminhoDoAnexoInterno(id)
  if (!caminho) return NextResponse.json({ ok: false, erro: "Arquivo inválido." }, { status: 400 })

  const download = await prepararDownloadInterno(usuario.id, id)
  if (!download) return NextResponse.json({ ok: false, erro: "Arquivo não encontrado." }, { status: 404 })

  let tamanho: number
  try {
    const info = await stat(caminho)
    if (!info.isFile()) throw new Error("não é arquivo")
    tamanho = info.size
  } catch {
    return NextResponse.json({ ok: false, erro: "Este arquivo já foi baixado ou expirou e foi removido do servidor." }, { status: 404 })
  }

  const leitura = createReadStream(caminho)
  // Só conclui quando o arquivo foi lido até o fim. Fora da requisição, o contexto de instância precisa ser explícito.
  leitura.on("end", () => {
    void runInWorkspace(download.workspaceId, () => concluirDownloadInterno(usuario.id, download)).catch(() => undefined)
  })

  const nomeAscii = download.meta.nome.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  return new NextResponse(Readable.toWeb(leitura) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": download.meta.mime || "application/octet-stream",
      "Content-Length": String(tamanho),
      "Content-Disposition": `attachment; filename="${nomeAscii}"; filename*=UTF-8''${encodeURIComponent(download.meta.nome)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
