"use server"

import { revalidatePath } from "next/cache"

import { createEvolutionInstance, type EvolutionInstance } from "@/services/evolution"

export type CriarInstanciaResult = {
  ok: boolean
  message: string
  instancia?: EvolutionInstance
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
