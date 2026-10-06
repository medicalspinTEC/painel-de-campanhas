"use server"

import { revalidatePath } from "next/cache"

import { AUDIO_TAMANHO_MAXIMO, extensaoDoMime } from "@/lib/audio-storage"
import { assertSecao } from "@/lib/session"
import { recordAppLog } from "@/services/app-logs"
import { addChatInternalNote, getChatInbox, getChatMessages, getChatsForExport } from "@/services/chat"
import { filtrarLeadsParaEnvio, pausarBotComNota } from "@/services/crm"
import { sendLeadAudio } from "@/services/leads"
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
