import { randomBytes } from "node:crypto"
import { prisma } from "@/lib/prisma"

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
    where: { id: "default" },
    create: { id: "default", token: novoToken, ativo: true },
    update: { token: novoToken, ativo: true },
  })

  return novoToken
}

export async function getToken(): Promise<InboundToken | null> {
  try {
    const row = await db.inboundWebhookToken.findUnique({ where: { id: "default" } })
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
  await db.inboundWebhookToken.update({ where: { id: "default" }, data: { ativo } })
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
  const row = await db.inboundWebhookToken.findUnique({ where: { id: "default" } })
  if (!row || !row.ativo || row.token !== token) return false

  await db.$transaction([
    db.inboundEvent.create({
      data: {
        evento,
        origem,
        payload: payload as object,
      },
    }),
    db.inboundWebhookToken.update({
      where: { id: "default" },
      data: { ultimoUsoEm: new Date() },
    }),
  ])

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
