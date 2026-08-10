"use server"

import { revalidatePath } from "next/cache"

import { saveSettings, type Settings } from "@/services/settings"
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
  return { ok: true, message: "Preferências salvas." }
}
