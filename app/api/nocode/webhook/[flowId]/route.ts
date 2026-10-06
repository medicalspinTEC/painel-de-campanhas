import { after, NextResponse } from "next/server"

import { runInWorkspace } from "@/lib/workspace-context"
import { processarMensagemParaBots } from "@/services/bots"
import { prepararWebhook, processarEventoWebhook, workspaceDoFluxo } from "@/services/nocode"

/**
 * Entrada de eventos da Evolution API para um fluxo do plugin No Code.
 *
 * POST /api/nocode/webhook/:flowId?token=<token do bloco Webhook>
 * (o token também pode ir no header `x-webhook-token`)
 *
 * Responde na hora e executa o fluxo em seguida, para a Evolution não esperar
 * (e não reenviar) enquanto o fluxo roda.
 */
export async function POST(request: Request, { params }: { params: Promise<{ flowId: string }> }) {
  const { flowId } = await params
  const url = new URL(request.url)
  const token = request.headers.get("x-webhook-token")?.trim() || url.searchParams.get("token")?.trim() || null

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, erro: "Corpo inválido: esperado JSON." }, { status: 400 })
  }

  // Rota pública: o fluxo define a instância; tudo abaixo roda dentro dela.
  const workspaceId = await workspaceDoFluxo(flowId)
  if (!workspaceId) return NextResponse.json({ ok: false, erro: "Fluxo não encontrado." }, { status: 404 })

  const preparo = await runInWorkspace(workspaceId, () => prepararWebhook(flowId, token))
  if (!preparo.ok) {
    return NextResponse.json({ ok: preparo.status === 202, erro: preparo.erro }, { status: preparo.status })
  }

  after(() =>
    runInWorkspace(workspaceId, async () => {
      await processarEventoWebhook(preparo.fluxo, payload)
      // O fluxo de resposta do sistema recebe toda mensagem dos leads: depois de registrá-la,
      // os bots de departamento respondem (se houver bot ativo e nenhum humano na conversa).
      if (preparo.fluxo.sistema) await processarMensagemParaBots(payload)
    }),
  )
  return NextResponse.json({ ok: true })
}
