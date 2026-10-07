"use server"

import { revalidatePath } from "next/cache"

import { PluginDesativadoError } from "@/lib/plugins"
import { ARQUIVO_TAMANHO_MAXIMO } from "@/lib/arquivo-storage"
import { AUDIO_TAMANHO_MAXIMO, extensaoDoMime } from "@/lib/audio-storage"
import { assertSecao } from "@/lib/session"
import { recordAppLog } from "@/services/app-logs"
import { addChatInternalNote, getChatInbox, getChatMessages, getChatsForExport } from "@/services/chat"
import { CrmError, filtrarLeadsParaEnvio, pausarBotComNota } from "@/services/crm"
import type { ChatTemplate } from "@/lib/chat-templates"
import {
  ChatTemplateError,
  createChatTemplate,
  deleteChatTemplate,
  listChatTemplates,
  updateChatTemplate,
} from "@/services/chat-templates"
import { configurarFollowUpChat, enviarFollowUpAgora, getFollowUpChat } from "@/services/followup"
import { sendLeadAudio, sendLeadFile } from "@/services/leads"
import { getCrmPluginAtivo } from "@/services/settings"

export async function refreshChatInboxAction(conversaId?: string | null, semMensagens = false) {
  await assertSecao("chat")
  return getChatInbox(conversaId, { semMensagens })
}

/** Só o histórico de uma conversa: abrir um lead não precisa recarregar a lista inteira. */
export async function loadChatMessagesAction(leadId: string) {
  await assertSecao("chat")
  return getChatMessages(leadId)
}

export async function createChatInternalNoteAction(leadId: string, texto: string) {
  const usuario = await assertSecao("chat")
  const leadIdLimpo = leadId.trim()
  const textoLimpo = texto.trim()

  if (!leadIdLimpo) return { ok: false, message: "Selecione um lead para adicionar a nota." }
  if (!textoLimpo) return { ok: false, message: "Escreva uma nota antes de salvar." }
  if (textoLimpo.length > 5000) {
    return { ok: false, message: "A nota é muito longa (máximo de 5000 caracteres)." }
  }

  try {
    await addChatInternalNote(leadIdLimpo, textoLimpo, usuario.nome)
    return { ok: true, message: "Nota interna adicionada." }
  } catch {
    return { ok: false, message: "Não foi possível salvar a nota interna." }
  }
}

/** Dados para exportar conversas (PDF/JSON). Sem `leadIds`, exporta todas. */
export async function exportChatsAction(leadIds?: string[] | null) {
  await assertSecao("chat")
  try {
    return { ok: true as const, conversas: await getChatsForExport(leadIds) }
  } catch {
    return { ok: false as const, message: "Não foi possível carregar as conversas para exportar." }
  }
}

/**
 * Envia uma mensagem de voz gravada no navegador. Segue as mesmas regras do texto
 * (permissão do CRM, pausa do bot) e não grava o áudio no banco: ver `sendLeadAudio`.
 * Recebe um FormData com `audio` (arquivo) e, opcionalmente, `instancia`.
 */
export async function sendChatAudioAction(leadId: string, formData: FormData) {
  const usuario = await assertSecao("chat")

  const arquivo = formData.get("audio")
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false, message: "Nenhum áudio foi recebido. Grave a mensagem novamente." }
  }
  if (arquivo.size > AUDIO_TAMANHO_MAXIMO) {
    return { ok: false, message: `O áudio é muito grande (máximo de ${Math.round(AUDIO_TAMANHO_MAXIMO / 1024 / 1024)} MB). Grave um áudio mais curto.` }
  }
  if (!extensaoDoMime(arquivo.type)) {
    return { ok: false, message: "Formato de áudio não suportado por este navegador." }
  }
  const instanciaBruta = formData.get("instancia")
  const instanciaNome = typeof instanciaBruta === "string" && instanciaBruta.trim() ? instanciaBruta.trim() : null

  try {
    // Plugin CRM: só quem é responsável (ou atende o departamento) responde ao lead.
    const { bloqueados } = await filtrarLeadsParaEnvio([leadId], usuario)
    if (bloqueados.length > 0) return { ok: false, message: bloqueados[0].motivo }

    const resultado = await sendLeadAudio(leadId, Buffer.from(await arquivo.arrayBuffer()), arquivo.type, instanciaNome)
    if (resultado.ok) {
      revalidatePath(`/leads/${leadId}`)
      // Um humano respondeu o lead: o bot sai da conversa até alguém reativá-lo.
      if (await getCrmPluginAtivo().catch(() => false)) {
        await pausarBotComNota(leadId, `Mensagem enviada por ${usuario.nome}.`)
      }
    }
    return resultado
  } catch (error) {
    await recordAppLog({ origem: "chat", mensagem: `Falha ao enviar mensagem de voz para o lead id=${leadId}.`, detalhes: error })
    return { ok: false, message: "Não foi possível enviar a mensagem de voz. Verifique a conexão com o banco." }
  }
}

/**
 * Envia uma imagem ou um arquivo escolhido no computador/celular. Nada fica guardado no app
 * (ver `sendLeadFile`). Recebe um FormData com `arquivo` e, opcionalmente, `legenda` e `instancia`.
 */
export async function sendChatFileAction(leadId: string, formData: FormData) {
  const usuario = await assertSecao("chat")

  const arquivo = formData.get("arquivo")
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false, message: "Nenhum arquivo foi recebido. Escolha o arquivo novamente." }
  }
  if (arquivo.size > ARQUIVO_TAMANHO_MAXIMO) {
    return { ok: false, message: `O arquivo é muito grande (máximo de ${Math.round(ARQUIVO_TAMANHO_MAXIMO / 1024 / 1024)} MB).` }
  }
  const legendaBruta = formData.get("legenda")
  const legenda = typeof legendaBruta === "string" ? legendaBruta.trim().slice(0, 1024) : ""
  const instanciaBruta = formData.get("instancia")
  const instanciaNome = typeof instanciaBruta === "string" && instanciaBruta.trim() ? instanciaBruta.trim() : null

  try {
    // Plugin CRM: só quem é responsável (ou atende o departamento) responde ao lead.
    const { bloqueados } = await filtrarLeadsParaEnvio([leadId], usuario)
    if (bloqueados.length > 0) return { ok: false, message: bloqueados[0].motivo }

    const resultado = await sendLeadFile(
      leadId,
      { dados: Buffer.from(await arquivo.arrayBuffer()), nome: arquivo.name, mime: arquivo.type },
      legenda || null,
      instanciaNome,
    )
    if (resultado.ok) {
      revalidatePath(`/leads/${leadId}`)
      // Um humano respondeu o lead: o bot sai da conversa até alguém reativá-lo.
      if (await getCrmPluginAtivo().catch(() => false)) {
        await pausarBotComNota(leadId, `Mensagem enviada por ${usuario.nome}.`)
      }
    }
    return resultado
  } catch (error) {
    await recordAppLog({ origem: "chat", mensagem: `Falha ao enviar arquivo para o lead id=${leadId}.`, detalhes: error })
    return { ok: false, message: "Não foi possível enviar o arquivo. Verifique a conexão com o banco." }
  }
}

// ---------------------------------------------------------------------------
// Follow-up automático da conversa (bot de follow-up do departamento)
// ---------------------------------------------------------------------------

/** Situação do follow-up na conversa, ou nulo se o departamento dela não tem bot de follow-up. */
export async function getFollowUpChatAction(leadId: string) {
  await assertSecao("chat")
  try {
    return { ok: true as const, info: await getFollowUpChat(leadId) }
  } catch (error) {
    await recordAppLog({ origem: "chat", mensagem: `Falha ao ler o follow-up do lead id=${leadId}.`, detalhes: error })
    return { ok: false as const, info: null, message: "Não foi possível carregar o follow-up desta conversa." }
  }
}

/** Liga/desliga o follow-up neste chat e/ou escolhe o template (`templateId: null` = regra do bot). */
export async function configureFollowUpChatAction(
  leadId: string,
  ajustes: { desativado?: boolean; templateId?: string | null },
) {
  const usuario = await assertSecao("chat")
  try {
    await configurarFollowUpChat(leadId, ajustes, usuario)
    return { ok: true, message: "Follow-up desta conversa atualizado." }
  } catch (error) {
    if (error instanceof CrmError || error instanceof PluginDesativadoError) return { ok: false, message: error.message }
    await recordAppLog({ origem: "chat", mensagem: `Falha ao ajustar o follow-up do lead id=${leadId}.`, detalhes: error })
    return { ok: false, message: "Não foi possível atualizar o follow-up desta conversa." }
  }
}

/** Envia agora um template de follow-up nesta conversa. */
export async function sendFollowUpNowAction(leadId: string, templateId: string | null) {
  const usuario = await assertSecao("chat")
  try {
    const resultado = await enviarFollowUpAgora(leadId, templateId, usuario)
    if (resultado.ok) revalidatePath(`/leads/${leadId}`)
    return resultado
  } catch (error) {
    if (error instanceof CrmError || error instanceof PluginDesativadoError) return { ok: false, message: error.message }
    await recordAppLog({ origem: "chat", mensagem: `Falha ao enviar follow-up manual ao lead id=${leadId}.`, detalhes: error })
    return { ok: false, message: "Não foi possível enviar o follow-up." }
  }
}

// ---------------------------------------------------------------------------
// Templates de mensagem ("/nome" no campo de mensagem). Pessoais: cada usuário
// vê e edita só os seus, até 10.
// ---------------------------------------------------------------------------

export type ChatTemplateResultado =
  | { ok: true; message: string; templates: ChatTemplate[] }
  | { ok: false; message: string }

async function executarTemplate(
  acao: (userId: string) => Promise<string>,
  falhaPadrao: string,
): Promise<ChatTemplateResultado> {
  const usuario = await assertSecao("chat")
  try {
    const message = await acao(usuario.id)
    return { ok: true, message, templates: await listChatTemplates(usuario.id) }
  } catch (error) {
    if (error instanceof ChatTemplateError) return { ok: false, message: error.message }
    await recordAppLog({ origem: "chat", mensagem: "Falha ao salvar template de mensagem do chat.", detalhes: error })
    return { ok: false, message: falhaPadrao }
  }
}

export async function listChatTemplatesAction(): Promise<ChatTemplate[]> {
  const usuario = await assertSecao("chat")
  return listChatTemplates(usuario.id)
}

export async function createChatTemplateAction(nome: string, texto: string) {
  return executarTemplate(async (userId) => {
    const criado = await createChatTemplate(userId, nome, texto)
    return `Template /${criado.nome} criado.`
  }, "Não foi possível criar o template.")
}

export async function updateChatTemplateAction(id: string, nome: string, texto: string) {
  return executarTemplate(async (userId) => {
    const atualizado = await updateChatTemplate(userId, id, nome, texto)
    return `Template /${atualizado.nome} atualizado.`
  }, "Não foi possível atualizar o template.")
}

export async function deleteChatTemplateAction(id: string) {
  return executarTemplate(async (userId) => {
    await deleteChatTemplate(userId, id)
    return "Template excluído."
  }, "Não foi possível excluir o template.")
}
