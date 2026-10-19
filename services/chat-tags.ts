import {
  CHAT_TAGS_MAX,
  CHAT_TAGS_POR_LEAD_MAX,
  CHAT_TAG_NOME_MAX,
  corValida,
  normalizarNomeTag,
  ordenarTags,
  type ChatTag,
  type ChatTagComContagem,
} from "@/lib/chat-tags"
import { prisma } from "@/lib/prisma"

/** Erro com mensagem pronta para mostrar ao usuário. */
export class ChatTagError extends Error {}

const SELECAO = { id: true, nome: true, cor: true } as const

function paraTag(row: { id: string; nome: string; cor: string }): ChatTag {
  return { id: row.id, nome: row.nome, cor: corValida(row.cor) }
}

/** Todas as etiquetas da instância, em ordem alfabética. */
export async function listChatTags(): Promise<ChatTag[]> {
  const rows = await prisma.chatTag.findMany({ select: SELECAO })
  return ordenarTags(rows.map(paraTag))
}

/** Etiquetas com a contagem de leads (tela de gerenciamento). */
export async function listChatTagsComContagem(): Promise<ChatTagComContagem[]> {
  const rows = await prisma.chatTag.findMany({ select: { ...SELECAO, _count: { select: { leads: true } } } })
  return ordenarTags(rows.map((row) => ({ ...paraTag(row), total: row._count.leads })))
}

function validarNome(nomeBruto: string): string {
  const nome = normalizarNomeTag(String(nomeBruto ?? ""))
  if (!nome) throw new ChatTagError("Informe o nome da etiqueta.")
  if (nome.length > CHAT_TAG_NOME_MAX) throw new ChatTagError(`O nome pode ter no máximo ${CHAT_TAG_NOME_MAX} caracteres.`)
  return nome
}

/** Já existe outra etiqueta com este nome (sem diferenciar maiúsculas/minúsculas)? */
async function nomeEmUso(nome: string, ignorarId?: string): Promise<boolean> {
  const achada = await prisma.chatTag.findFirst({
    where: { nome: { equals: nome, mode: "insensitive" }, ...(ignorarId ? { NOT: { id: ignorarId } } : {}) },
    select: { id: true },
  })
  return Boolean(achada)
}

export async function createChatTag(nomeBruto: string, corBruta: string): Promise<ChatTag> {
  const nome = validarNome(nomeBruto)
  if ((await prisma.chatTag.count()) >= CHAT_TAGS_MAX) {
    throw new ChatTagError(`O limite de ${CHAT_TAGS_MAX} etiquetas foi atingido. Exclua uma para criar outra.`)
  }
  if (await nomeEmUso(nome)) throw new ChatTagError(`Já existe uma etiqueta chamada "${nome}".`)
  return paraTag(await prisma.chatTag.create({ data: { nome, cor: corValida(corBruta) }, select: SELECAO }))
}

export async function updateChatTag(id: string, nomeBruto: string, corBruta: string): Promise<ChatTag> {
  const nome = validarNome(nomeBruto)
  const atual = await prisma.chatTag.findFirst({ where: { id }, select: { id: true } })
  if (!atual) throw new ChatTagError("Etiqueta não encontrada.")
  if (await nomeEmUso(nome, id)) throw new ChatTagError(`Já existe uma etiqueta chamada "${nome}".`)
  return paraTag(await prisma.chatTag.update({ where: { id }, data: { nome, cor: corValida(corBruta) }, select: SELECAO }))
}

/** Exclui a etiqueta e a remove de todos os leads (cascata). */
export async function deleteChatTag(id: string): Promise<void> {
  const { count } = await prisma.chatTag.deleteMany({ where: { id } })
  if (count === 0) throw new ChatTagError("Etiqueta não encontrada.")
}

/** Aplica ou remove uma etiqueta de um lead. Idempotente: repetir não duplica nem falha. */
export async function setLeadChatTag(leadId: string, tagId: string, aplicada: boolean): Promise<ChatTag[]> {
  const [lead, tag] = await Promise.all([
    prisma.lead.findFirst({ where: { id: leadId }, select: { id: true } }),
    prisma.chatTag.findFirst({ where: { id: tagId }, select: { id: true } }),
  ])
  if (!lead) throw new ChatTagError("Conversa não encontrada.")
  if (!tag) throw new ChatTagError("Etiqueta não encontrada.")

  if (aplicada) {
    const jaTem = await prisma.chatTagLead.findFirst({ where: { leadId, tagId }, select: { id: true } })
    if (!jaTem) {
      if ((await prisma.chatTagLead.count({ where: { leadId } })) >= CHAT_TAGS_POR_LEAD_MAX) {
        throw new ChatTagError(`Uma conversa pode ter no máximo ${CHAT_TAGS_POR_LEAD_MAX} etiquetas.`)
      }
      await prisma.chatTagLead.createMany({ data: [{ leadId, tagId }], skipDuplicates: true })
    }
  } else {
    await prisma.chatTagLead.deleteMany({ where: { leadId, tagId } })
  }
  return listTagsDoLead(leadId)
}

export async function listTagsDoLead(leadId: string): Promise<ChatTag[]> {
  const rows = await prisma.chatTagLead.findMany({ where: { leadId }, select: { tag: { select: SELECAO } } })
  return ordenarTags(rows.map((row) => paraTag(row.tag)))
}
