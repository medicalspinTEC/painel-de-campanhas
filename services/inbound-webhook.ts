import { randomBytes } from "node:crypto"
import { prisma, prismaGlobal } from "@/lib/prisma"
import { runInWorkspace, workspaceAtualId } from "@/lib/workspace-context"
import { recordAppLog } from "@/services/app-logs"
import { processarRespostaLead } from "@/services/lead-response"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

export interface InboundToken {
  token: string
  ativo: boolean
  criadoEm: string
  ultimoUsoEm: string | null
  totalEventos: number
}

export interface InboundEvent {
  id: string
  evento: string
  origem: string | null
  payload: unknown
  recebidoEm: string
}

/**
 * Gera ou regenera o token de autenticação do webhook de entrada.
 * Há sempre apenas um token ativo; regenerar invalida o anterior.
 */
export async function gerarToken(): Promise<string> {
  const novoToken = `whin_${randomBytes(32).toString("hex")}`

  await db.inboundWebhookToken.upsert({
    where: { workspaceId: await workspaceAtualId() },
    create: { token: novoToken, ativo: true },
    update: { token: novoToken, ativo: true },
  })

  return novoToken
}

export async function getToken(): Promise<InboundToken | null> {
  try {
    const row = await db.inboundWebhookToken.findUnique({ where: { workspaceId: await workspaceAtualId() } })
    if (!row) return null

    const totalEventos = await db.inboundEvent.count()

    return {
      token: row.token,
      ativo: row.ativo,
      criadoEm: row.criadoEm.toISOString(),
      ultimoUsoEm: row.ultimoUsoEm?.toISOString() ?? null,
      totalEventos,
    }
  } catch {
    return null
  }
}

export async function toggleToken(ativo: boolean): Promise<void> {
  await db.inboundWebhookToken.update({ where: { workspaceId: await workspaceAtualId() }, data: { ativo } })
}

/**
 * Valida o token de entrada e grava o evento recebido.
 * Retorna false se o token for inválido ou inativo.
 */
export async function receberEvento(
  token: string,
  evento: string,
  payload: unknown,
  origem: string | null,
): Promise<boolean> {
  // Endpoint público: o token é o que diz de QUAL instância é o evento. A busca é global
  // de propósito; daqui em diante tudo roda dentro da instância dona do token.
  const row = await prismaGlobal.inboundWebhookToken.findFirst({ where: { token } })
  if (!row || !row.ativo) return false
  const workspace = await prismaGlobal.workspace.findUnique({ where: { id: row.workspaceId }, select: { ativo: true } })
  if (!workspace?.ativo) return false

  return runInWorkspace(row.workspaceId, () => registrarEvento(evento, payload, origem))
}

async function registrarEvento(evento: string, payload: unknown, origem: string | null): Promise<boolean> {
  await db.$transaction([
    db.inboundEvent.create({
      data: {
        evento,
        origem,
        payload: payload as object,
      },
    }),
    db.inboundWebhookToken.update({
      where: { workspaceId: await workspaceAtualId() },
      data: { ultimoUsoEm: new Date() },
    }),
  ])

  /*
   * Eventos com efeito de negócio são processados após serem persistidos. A
   * falha no processamento não invalida o recebimento (o evento já foi gravado
   * para auditoria), então o erro é apenas registrado nos logs.
   */
  if (evento === "RespostaLead") {
    try {
      await processarRespostaLead(payload)
    } catch (error) {
      await recordAppLog({
        nivel: "erro",
        origem: "inbound-webhook",
        mensagem: "Falha ao processar evento RespostaLead.",
        detalhes: error,
      })
    }
  }

  return true
}

export async function listEventos(limite = 50): Promise<InboundEvent[]> {
  try {
    const rows = await db.inboundEvent.findMany({
      orderBy: { recebidoEm: "desc" },
      take: limite,
    })

    return rows.map((r: { id: string; evento: string; origem: string | null; payload: unknown; recebidoEm: Date }) => ({
      id: r.id,
      evento: r.evento,
      origem: r.origem,
      payload: r.payload,
      recebidoEm: r.recebidoEm.toISOString(),
    }))
  } catch {
    return []
  }
}

export async function limparEventos(): Promise<number> {
  const result = await db.inboundEvent.deleteMany()
  return result.count
}
