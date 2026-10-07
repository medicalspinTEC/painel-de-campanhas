import {
  CHAT_TEMPLATES_MAX,
  CHAT_TEMPLATE_NOME_MAX,
  CHAT_TEMPLATE_TEXTO_MAX,
  normalizarNomeTemplate,
  type ChatTemplate,
} from "@/lib/chat-templates"
import { prisma } from "@/lib/prisma"

/** Erro com mensagem pronta para mostrar ao usuário. */
export class ChatTemplateError extends Error {}

const SELECAO = { id: true, nome: true, texto: true } as const

/** Templates do próprio usuário, em ordem alfabética do nome. */
export async function listChatTemplates(userId: string): Promise<ChatTemplate[]> {
  return prisma.chatTemplate.findMany({ where: { userId }, orderBy: { nome: "asc" }, select: SELECAO })
}

function validar(nomeBruto: string, textoBruto: string) {
  const nome = normalizarNomeTemplate(String(nomeBruto ?? ""))
  const texto = String(textoBruto ?? "").trim()
  if (!nome) throw new ChatTemplateError("Informe um nome (letras, números, hífen ou sublinhado).")
  if (nome.length > CHAT_TEMPLATE_NOME_MAX) {
    throw new ChatTemplateError(`O nome pode ter no máximo ${CHAT_TEMPLATE_NOME_MAX} caracteres.`)
  }
  if (!texto) throw new ChatTemplateError("Escreva o texto do template.")
  if (texto.length > CHAT_TEMPLATE_TEXTO_MAX) {
    throw new ChatTemplateError(`O texto pode ter no máximo ${CHAT_TEMPLATE_TEXTO_MAX} caracteres.`)
  }
  return { nome, texto }
}

export async function createChatTemplate(userId: string, nomeBruto: string, textoBruto: string): Promise<ChatTemplate> {
  const { nome, texto } = validar(nomeBruto, textoBruto)

  if ((await prisma.chatTemplate.count({ where: { userId } })) >= CHAT_TEMPLATES_MAX) {
    throw new ChatTemplateError(`Você já tem ${CHAT_TEMPLATES_MAX} templates. Exclua um para criar outro.`)
  }
  if (await prisma.chatTemplate.findFirst({ where: { userId, nome }, select: { id: true } })) {
    throw new ChatTemplateError(`Já existe um template chamado "/${nome}".`)
  }

  return prisma.chatTemplate.create({ data: { userId, nome, texto }, select: SELECAO })
}

export async function updateChatTemplate(userId: string, id: string, nomeBruto: string, textoBruto: string): Promise<ChatTemplate> {
  const { nome, texto } = validar(nomeBruto, textoBruto)

  const atual = await prisma.chatTemplate.findFirst({ where: { id, userId }, select: { id: true } })
  if (!atual) throw new ChatTemplateError("Template não encontrado.")
  if (await prisma.chatTemplate.findFirst({ where: { userId, nome, NOT: { id } }, select: { id: true } })) {
    throw new ChatTemplateError(`Já existe um template chamado "/${nome}".`)
  }

  return prisma.chatTemplate.update({ where: { id }, data: { nome, texto }, select: SELECAO })
}

export async function deleteChatTemplate(userId: string, id: string): Promise<void> {
  // Filtra por userId: ninguém exclui o template de outra pessoa.
  const { count } = await prisma.chatTemplate.deleteMany({ where: { id, userId } })
  if (count === 0) throw new ChatTemplateError("Template não encontrado.")
}
