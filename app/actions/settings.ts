"use server"

import { revalidatePath } from "next/cache"

import {
  saveAppMarca,
  saveSettings,
  setAssistentePluginAtivo,
  setChatPluginAtivo,
  setCrmPluginAtivo,
  setKanbanPluginAtivo,
  setNocodePluginAtivo,
  type Settings,
} from "@/services/settings"
import { recordAppLog } from "@/services/app-logs"
import { garantirFluxoResposta } from "@/services/nocode"
import { assertSecao } from "@/lib/session"

export type SettingsActionResult = { ok: boolean; message: string }

const HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/

export async function saveSettingsAction(input: Settings): Promise<SettingsActionResult> {
  await assertSecao("configuracoes")
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
  await assertSecao("integracoes")
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
  await assertSecao("integracoes")
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
  await assertSecao("integracoes")
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

export async function setNocodePluginAtivoAction(ativo: boolean): Promise<SettingsActionResult & { ativo?: boolean }> {
  await assertSecao("integracoes")
  if (typeof ativo !== "boolean") return { ok: false, message: "Estado inválido para o plugin." }

  try {
    await setNocodePluginAtivo(ativo)
    // Ao ligar o plugin, o fluxo de resposta do app já nasce configurado e ativo.
    if (ativo) await garantirFluxoResposta()
  } catch (error) {
    await recordAppLog({ origem: "settings", mensagem: "Falha ao atualizar o plugin No Code.", detalhes: error })
    return { ok: false, message: "Não foi possível atualizar o plugin No Code. Aplique a migration mais recente." }
  }

  revalidatePath("/integracoes")
  revalidatePath("/nocode")
  revalidatePath("/", "layout")
  return { ok: true, message: ativo ? "Plugin No Code ativado." : "Plugin No Code desativado.", ativo }
}

export async function setCrmPluginAtivoAction(ativo: boolean): Promise<SettingsActionResult & { ativo?: boolean }> {
  await assertSecao("integracoes")
  if (typeof ativo !== "boolean") return { ok: false, message: "Estado inválido para o plugin." }

  try {
    await setCrmPluginAtivo(ativo)
  } catch (error) {
    await recordAppLog({ origem: "settings", mensagem: "Falha ao atualizar o plugin CRM.", detalhes: error })
    return { ok: false, message: "Não foi possível atualizar o plugin CRM. Aplique a migration mais recente." }
  }

  revalidatePath("/integracoes")
  revalidatePath("/crm")
  revalidatePath("/chat")
  revalidatePath("/", "layout")
  return { ok: true, message: ativo ? "Plugin CRM ativado." : "Plugin CRM desativado.", ativo }
}

const LIMITE_NOME_MARCA = 40
const LIMITE_LOGO_CHARS = 200_000
const LOGO_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/

/** Nome e logo exibidos no topo da sidebar. `logo: null` volta à logo padrão. */
export async function saveAppMarcaAction(input: { nome: string; logo: string | null }): Promise<SettingsActionResult> {
  await assertSecao("configuracoes")
  const nome = String(input?.nome ?? "").trim()
  const logo = input?.logo ?? null

  if (!nome) return { ok: false, message: "Informe o nome exibido na sidebar." }
  if (nome.length > LIMITE_NOME_MARCA) {
    return { ok: false, message: `O nome pode ter no máximo ${LIMITE_NOME_MARCA} caracteres.` }
  }
  if (logo !== null) {
    if (typeof logo !== "string" || logo.length > LIMITE_LOGO_CHARS || !LOGO_DATA_URL.test(logo)) {
      return { ok: false, message: "Envie uma imagem PNG, JPG ou WebP válida (até ~150 KB após o ajuste)." }
    }
  }

  try {
    await saveAppMarca({ nome, logo })
  } catch (error) {
    await recordAppLog({ origem: "settings", mensagem: "Falha ao salvar nome e logo da sidebar.", detalhes: error })
    return { ok: false, message: "Não foi possível salvar. Verifique se a migration mais recente foi aplicada." }
  }

  revalidatePath("/configuracoes")
  revalidatePath("/", "layout")
  return { ok: true, message: "Identidade do painel atualizada." }
}
