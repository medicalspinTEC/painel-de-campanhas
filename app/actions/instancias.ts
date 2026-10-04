"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"

import {
  connectEvolutionInstance,
  createEvolutionInstance,
  deleteEvolutionInstance,
  getEvolutionConnectionState,
  logoutEvolutionInstance,
  type EvolutionInstance,
  type EvolutionInstanceState,
} from "@/services/evolution"
import { configurarWebhookDaInstancia, type ResultadoWebhookInstancia } from "@/services/nocode"
import { assertSecao } from "@/lib/session"

export type CriarInstanciaResult = {
  ok: boolean
  message: string
  instancia?: EvolutionInstance
  /** Resultado da configuração automática do webhook (plugin No Code). */
  webhook?: ResultadoWebhookInstancia
}

/** Endereço público do app: `APP_PUBLIC_URL` ou o host da requisição atual. */
async function origemPublica(): Promise<string | null> {
  const env = process.env.APP_PUBLIC_URL?.trim()
  if (env) return env.replace(/\/$/, "")
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host")
  if (!host) return null
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || (/^(localhost|127\.)/.test(host) ? "http" : "https")
  return `${proto}://${host}`
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
  await assertSecao("instancias")
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

  // Facilita o setup: já liga o webhook da instância no fluxo No Code ativo.
  const webhook = await configurarWebhookDaInstancia(nome, await origemPublica())

  revalidatePath("/instancias")
  return { ok: true, message: `Instância "${nome}" criada na Evolution.`, instancia: resultado.instancia, webhook }
}

/** (Re)aplica o webhook do fluxo No Code ativo numa instância existente. */
export async function configurarWebhookInstanciaAction(nome: string): Promise<ResultadoWebhookInstancia> {
  await assertSecao("instancias")
  const instancia = nome?.trim() ?? ""
  if (!instancia) return { ok: false, message: "Nome da instância ausente." }
  return configurarWebhookDaInstancia(instancia, await origemPublica())
}

/** Gera o QR Code / pairing code para parear a instância. */
export async function conectarInstanciaAction(nome: string): Promise<ConectarInstanciaResult> {
  await assertSecao("instancias")
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
  await assertSecao("instancias")
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
  await assertSecao("instancias")
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
  await assertSecao("instancias")
  const instancia = nome?.trim() ?? ""
  if (!instancia) return { ok: false, message: "Nome da instância ausente." }

  const resultado = await deleteEvolutionInstance(instancia)
  if (!resultado.ok) {
    return { ok: false, message: resultado.erro ?? "Não foi possível remover a instância." }
  }

  revalidatePath("/instancias")
  return { ok: true, message: `Instância "${instancia}" removida.` }
}
