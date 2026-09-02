"use server"

import { revalidatePath } from "next/cache"

import {
  connectEvolutionInstance,
  createEvolutionInstance,
  deleteEvolutionInstance,
  getEvolutionConnectionState,
  logoutEvolutionInstance,
  type EvolutionInstance,
  type EvolutionInstanceState,
} from "@/services/evolution"

export type CriarInstanciaResult = {
  ok: boolean
  message: string
  instancia?: EvolutionInstance
}

export type ConectarInstanciaResult = {
  ok: boolean
  message?: string
  qrCode?: string
  pairingCode?: string
  code?: string
  jaConectada?: boolean
}

export type StatusInstanciaResult = {
  ok: boolean
  message?: string
  estado?: EvolutionInstanceState
}

/*
 * Nomes de instância na Evolution viram parte da URL de várias rotas
 * (/instance/connect/{nome} etc.), então restringimos a caracteres seguros:
 * letras, números, hífen e underline, sem espaços.
 */
const NOME_VALIDO = /^[a-zA-Z0-9_-]+$/

export async function criarInstanciaAction(input: {
  nome: string
  numero?: string
}): Promise<CriarInstanciaResult> {
  const nome = input.nome?.trim() ?? ""
  if (!nome) return { ok: false, message: "Informe um nome para a instância." }
  if (!NOME_VALIDO.test(nome)) {
    return {
      ok: false,
      message: "Use apenas letras, números, hífen ou underline no nome (sem espaços ou acentos).",
    }
  }

  const resultado = await createEvolutionInstance({ nome, numero: input.numero })
  if (!resultado.ok) {
    return { ok: false, message: resultado.erro ?? "Não foi possível criar a instância." }
  }

  revalidatePath("/instancias")
  return { ok: true, message: `Instância "${nome}" criada na Evolution.`, instancia: resultado.instancia }
}

/** Gera o QR Code / pairing code para parear a instância. */
export async function conectarInstanciaAction(nome: string): Promise<ConectarInstanciaResult> {
  const instancia = nome?.trim() ?? ""
  if (!instancia) return { ok: false, message: "Nome da instância ausente." }

  const resultado = await connectEvolutionInstance(instancia)
  if (!resultado.ok) {
    return { ok: false, message: resultado.erro ?? "Não foi possível gerar o QR Code." }
  }

  return {
    ok: true,
    qrCode: resultado.qrCode,
    pairingCode: resultado.pairingCode,
    code: resultado.code,
    jaConectada: resultado.jaConectada,
  }
}

/** Consulta o estado atual da conexão (usado no polling do diálogo). */
export async function statusInstanciaAction(nome: string): Promise<StatusInstanciaResult> {
  const instancia = nome?.trim() ?? ""
  if (!instancia) return { ok: false, message: "Nome da instância ausente." }

  const resultado = await getEvolutionConnectionState(instancia)
  if (!resultado.ok) {
    return { ok: false, message: resultado.erro ?? "Não foi possível consultar o status." }
  }

  return { ok: true, estado: resultado.estado }
}

/** Desconecta o WhatsApp da instância (logout). */
export async function desconectarInstanciaAction(nome: string): Promise<{ ok: boolean; message: string }> {
  const instancia = nome?.trim() ?? ""
  if (!instancia) return { ok: false, message: "Nome da instância ausente." }

  const resultado = await logoutEvolutionInstance(instancia)
  if (!resultado.ok) {
    return { ok: false, message: resultado.erro ?? "Não foi possível desconectar a instância." }
  }

  revalidatePath("/instancias")
  return { ok: true, message: `Instância "${instancia}" desconectada.` }
}

/** Remove a instância por completo na Evolution API. */
export async function removerInstanciaAction(nome: string): Promise<{ ok: boolean; message: string }> {
  const instancia = nome?.trim() ?? ""
  if (!instancia) return { ok: false, message: "Nome da instância ausente." }

  const resultado = await deleteEvolutionInstance(instancia)
  if (!resultado.ok) {
    return { ok: false, message: resultado.erro ?? "Não foi possível remover a instância." }
  }

  revalidatePath("/instancias")
  return { ok: true, message: `Instância "${instancia}" removida.` }
}
