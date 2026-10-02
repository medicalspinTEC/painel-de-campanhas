"use server"

import { revalidatePath } from "next/cache"

import { isTemaApp } from "@/lib/temas"
import {
  saveSettings,
  setAssistentePluginAtivo,
  setChatPluginAtivo,
  setKanbanPluginAtivo,
  type Settings,
} from "@/services/settings"
import { recordAppLog } from "@/services/app-logs"

export type SettingsActionResult = { ok: boolean; message: string }

const HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/

export async function saveSettingsAction(input: Settings): Promise<SettingsActionResult> {
  const remetente = input.remetente.trim()
  if (!remetente) return { ok: false, message: "Informe o nome do remetente." }

  if (!HORARIO.test(input.janelaInicio) || !HORARIO.test(input.janelaFim)) {
    return { ok: false, message: "Informe horários válidos no formato HH:MM." }
  }
  if (input.janelaInicio >= input.janelaFim) {
    return { ok: false, message: "O início da janela deve ser anterior ao fim." }
  }
  if (!Number.isInteger(input.limiteDiario) || input.limiteDiario < 1) {
    return { ok: false, message: "O limite diário deve ser um número maior que zero." }
  }
  if (!Number.isInteger(input.maxEnviosPorPeriodo) || input.maxEnviosPorPeriodo < 1) {
    return { ok: false, message: "O máximo de envios por período deve ser um número maior que zero." }
  }
  if (!Number.isInteger(input.periodoEsperaValor) || input.periodoEsperaValor < 1) {
    return { ok: false, message: "O tempo de espera deve ser um número maior que zero." }
  }
  if (input.periodoEsperaUnidade !== "minutos" && input.periodoEsperaUnidade !== "horas") {
    return { ok: false, message: "Selecione uma unidade válida para o tempo de espera." }
  }
  if (!isTemaApp(input.temaApp)) {
    return { ok: false, message: "Selecione um dos temas disponíveis." }
  }

  try {
    await saveSettings({
      ...input,
      remetente,
      numero: input.numero.trim(),
      assinatura: input.assinatura.trim(),
    })
  } catch (error) {
    await recordAppLog({ origem: "settings", mensagem: "Falha ao salvar preferências.", detalhes: error })
    return { ok: false, message: "Não foi possível salvar as preferências." }
  }

  revalidatePath("/configuracoes")
  revalidatePath("/", "layout")
  return { ok: true, message: "Preferências salvas." }
}

export async function setChatPluginAtivoAction(ativo: boolean): Promise<SettingsActionResult & { ativo?: boolean }> {
  if (typeof ativo !== "boolean") return { ok: false, message: "Estado inválido para o plugin." }

  try {
    await setChatPluginAtivo(ativo)
  } catch (error) {
    await recordAppLog({ origem: "settings", mensagem: "Falha ao atualizar o plugin de chat.", detalhes: error })
    return { ok: false, message: "Não foi possível atualizar o plugin de chat." }
  }

  revalidatePath("/integracoes")
  revalidatePath("/chat")
  revalidatePath("/", "layout")
  return { ok: true, message: ativo ? "Plugin Chat ativado." : "Plugin Chat desativado.", ativo }
}

export async function setKanbanPluginAtivoAction(ativo: boolean): Promise<SettingsActionResult & { ativo?: boolean }> {
  if (typeof ativo !== "boolean") return { ok: false, message: "Estado inválido para o plugin." }

  try {
    await setKanbanPluginAtivo(ativo)
  } catch (error) {
    await recordAppLog({ origem: "settings", mensagem: "Falha ao atualizar o plugin de kanban.", detalhes: error })
    return { ok: false, message: "Não foi possível atualizar o plugin de kanban." }
  }

  revalidatePath("/integracoes")
  revalidatePath("/kanban")
  revalidatePath("/", "layout")
  return { ok: true, message: ativo ? "Plugin Kanban ativado." : "Plugin Kanban desativado.", ativo }
}

export async function setAssistentePluginAtivoAction(ativo: boolean): Promise<SettingsActionResult & { ativo?: boolean }> {
  if (typeof ativo !== "boolean") return { ok: false, message: "Estado inválido para o plugin." }

  try {
    await setAssistentePluginAtivo(ativo)
  } catch (error) {
    await recordAppLog({ origem: "settings", mensagem: "Falha ao atualizar o plugin Assistente.", detalhes: error })
    return { ok: false, message: "Não foi possível atualizar o plugin Assistente." }
  }

  revalidatePath("/integracoes")
  revalidatePath("/assistente")
  revalidatePath("/", "layout")
  return { ok: true, message: ativo ? "Plugin Assistente ativado." : "Plugin Assistente desativado.", ativo }
}
