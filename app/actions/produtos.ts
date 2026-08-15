"use server"

import { revalidatePath } from "next/cache"

import { recordAppLog } from "@/services/app-logs"
import {
  createProduto,
  deleteProduto,
  ProdutoDuplicadoError,
  updateProduto,
  type ProdutoInput,
} from "@/services/produtos"

export interface ProdutoActionResult {
  ok: boolean
  message: string
  errors?: Record<string, string>
}

/** Tamanho máximo do nome, alinhado ao limite dos campos de segmentação. */
const MAX_NOME = 60
const MAX_DESCRICAO = 280

function validar(input: ProdutoInput): { erros: Record<string, string> } | { dados: ProdutoInput } {
  const erros: Record<string, string> = {}
  const nome = input.nome.trim()
  const descricao = (input.descricao ?? "").trim()

  if (nome.length < 2) erros.nome = "Informe um nome com pelo menos 2 caracteres."
  else if (nome.length > MAX_NOME) erros.nome = `Use no máximo ${MAX_NOME} caracteres.`
  if (descricao.length > MAX_DESCRICAO) erros.descricao = `Use no máximo ${MAX_DESCRICAO} caracteres.`

  if (Object.keys(erros).length > 0) return { erros }
  return { dados: { nome, descricao: descricao || null, ativo: input.ativo } }
}

function revalidar() {
  revalidatePath("/segmentacao")
  // As opções de produto do formulário de leads dependem deste catálogo.
  revalidatePath("/leads")
}

export async function createProdutoAction(input: ProdutoInput): Promise<ProdutoActionResult> {
  const validado = validar(input)
  if ("erros" in validado) return { ok: false, message: "Corrija os campos destacados.", errors: validado.erros }

  try {
    await createProduto(validado.dados)
  } catch (error) {
    if (error instanceof ProdutoDuplicadoError) {
      return { ok: false, message: error.message, errors: { nome: error.message } }
    }
    await recordAppLog({ origem: "produtos", mensagem: "Falha ao criar produto.", detalhes: error })
    return { ok: false, message: "Não foi possível salvar o produto. Verifique a conexão com o banco." }
  }

  revalidar()
  return { ok: true, message: `Produto "${validado.dados.nome}" cadastrado.` }
}

export async function updateProdutoAction(id: string, input: ProdutoInput): Promise<ProdutoActionResult> {
  const validado = validar(input)
  if ("erros" in validado) return { ok: false, message: "Corrija os campos destacados.", errors: validado.erros }

  try {
    const atualizado = await updateProduto(id, validado.dados)
    if (!atualizado) return { ok: false, message: "Produto não encontrado." }
  } catch (error) {
    if (error instanceof ProdutoDuplicadoError) {
      return { ok: false, message: error.message, errors: { nome: error.message } }
    }
    await recordAppLog({ origem: "produtos", mensagem: `Falha ao atualizar produto id=${id}.`, detalhes: error })
    return { ok: false, message: "Não foi possível atualizar o produto. Verifique a conexão com o banco." }
  }

  revalidar()
  return { ok: true, message: `Produto "${validado.dados.nome}" atualizado.` }
}

export async function deleteProdutoAction(id: string): Promise<ProdutoActionResult> {
  try {
    await deleteProduto(id)
  } catch (error) {
    await recordAppLog({ origem: "produtos", mensagem: `Falha ao excluir produto id=${id}.`, detalhes: error })
    return { ok: false, message: "Não foi possível excluir o produto." }
  }

  revalidar()
  return { ok: true, message: "Produto excluído." }
}
