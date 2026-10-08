"use server"

import { revalidatePath } from "next/cache"

import { PluginDesativadoError } from "@/lib/plugins"
import { assertSecao, ForbiddenError } from "@/lib/session"
import { recordAppLog } from "@/services/app-logs"
import {
  AgenteIaError,
  ativarAgente,
  atualizarAgente,
  criarAgente,
  excluirAgente,
  listarModelosDoProvedor,
  type AgenteIaInput,
  type ModeloIa,
} from "@/services/agentes-ia"

export type AgenteIaActionResult = { ok: boolean; message: string }

function falha(error: unknown, contexto: string): AgenteIaActionResult {
  if (error instanceof AgenteIaError || error instanceof ForbiddenError || error instanceof PluginDesativadoError) {
    return { ok: false, message: error.message }
  }
  // Nunca registra o corpo da chamada: ele pode conter a chave de API.
  void recordAppLog({ origem: "agentes-ia", mensagem: contexto, detalhes: error instanceof Error ? error.message : String(error) })
  return { ok: false, message: contexto }
}

function revalidar() {
  revalidatePath("/agentes-ia")
  revalidatePath("/crm")
}

export async function createAgenteIaAction(input: AgenteIaInput): Promise<AgenteIaActionResult & { id?: string }> {
  try {
    await assertSecao("agentes_ia")
    const { id } = await criarAgente(input)
    revalidar()
    return { ok: true, message: "Agente criado. Ative-o e vincule a um departamento ou à entrada na aba CRM.", id }
  } catch (error) {
    return falha(error, "Não foi possível criar o agente.")
  }
}

export async function updateAgenteIaAction(id: string, input: AgenteIaInput): Promise<AgenteIaActionResult> {
  try {
    await assertSecao("agentes_ia")
    await atualizarAgente(id, input)
    revalidar()
    return { ok: true, message: "Agente atualizado." }
  } catch (error) {
    return falha(error, "Não foi possível salvar o agente.")
  }
}

export async function setAgenteIaAtivoAction(id: string, ativo: boolean): Promise<AgenteIaActionResult> {
  try {
    await assertSecao("agentes_ia")
    if (typeof ativo !== "boolean") return { ok: false, message: "Estado inválido." }
    await ativarAgente(id, ativo)
    revalidar()
    return { ok: true, message: ativo ? "Agente ativado." : "Agente desativado. Ele não responde mais as conversas." }
  } catch (error) {
    return falha(error, "Não foi possível alterar o agente.")
  }
}

export async function deleteAgenteIaAction(id: string): Promise<AgenteIaActionResult> {
  try {
    await assertSecao("agentes_ia")
    await excluirAgente(id)
    revalidar()
    return { ok: true, message: "Agente excluído." }
  } catch (error) {
    return falha(error, "Não foi possível excluir o agente.")
  }
}

/** Carrega os modelos da conta (e testa a chave). Com a chave em branco, usa a do agente salvo. */
export async function listarModelosIaAction(input: {
  provedor: string
  baseUrl?: string | null
  apiKey?: string | null
  agenteId?: string | null
}): Promise<AgenteIaActionResult & { modelos?: ModeloIa[] }> {
  try {
    await assertSecao("agentes_ia")
    const modelos = await listarModelosDoProvedor(input)
    return { ok: true, message: `Chave válida. ${modelos.length} modelo(s) disponível(is).`, modelos }
  } catch (error) {
    return falha(error, "Não foi possível carregar os modelos.")
  }
}
