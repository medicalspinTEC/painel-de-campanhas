"use server"

import { revalidatePath } from "next/cache"

import { recordAppLog } from "@/services/app-logs"
import {
  ItemCatalogoDuplicadoError,
  servicoMarcas,
  servicoPersonas,
  servicoRegioes,
  type ItemCatalogoInput,
  type ServicoCatalogo,
} from "@/services/catalogo-segmentacao"

export interface CatalogoActionResult {
  ok: boolean
  message: string
  errors?: Record<string, string>
}

/** Tamanho máximo do nome, alinhado ao limite dos campos de segmentação. */
const MAX_NOME = 60
const MAX_DESCRICAO = 280

function validar(
  input: ItemCatalogoInput,
  rotulo: string,
): { erros: Record<string, string> } | { dados: ItemCatalogoInput } {
  const erros: Record<string, string> = {}
  const nome = input.nome.trim()
  const descricao = (input.descricao ?? "").trim()

  if (nome.length < 2) erros.nome = `Informe ${rotulo} com pelo menos 2 caracteres.`
  else if (nome.length > MAX_NOME) erros.nome = `Use no máximo ${MAX_NOME} caracteres.`
  if (descricao.length > MAX_DESCRICAO) erros.descricao = `Use no máximo ${MAX_DESCRICAO} caracteres.`

  if (Object.keys(erros).length > 0) return { erros }
  return { dados: { nome, descricao: descricao || null, ativo: input.ativo } }
}

function revalidar() {
  revalidatePath("/segmentacao")
  // As opções de segmentação do formulário de leads dependem destes catálogos.
  revalidatePath("/leads")
}

/**
 * Gera o trio de actions (criar/atualizar/excluir) para um catálogo. Mantém a
 * mesma lógica de validação, tratamento de duplicidade, log e revalidação
 * usada pelos produtos, sem repetir o código para cada dimensão.
 */
function criarActionsCatalogo(
  servico: ServicoCatalogo,
  origem: string,
  /** Rótulo indefinido, ex.: "uma marca". */
  rotuloIndefinido: string,
  /** Rótulo definido capitalizado, ex.: "Marca". */
  rotuloDefinido: string,
) {
  async function criar(input: ItemCatalogoInput): Promise<CatalogoActionResult> {
    const validado = validar(input, rotuloIndefinido)
    if ("erros" in validado) return { ok: false, message: "Corrija os campos destacados.", errors: validado.erros }

    try {
      await servico.criar(validado.dados)
    } catch (error) {
      if (error instanceof ItemCatalogoDuplicadoError) {
        return { ok: false, message: error.message, errors: { nome: error.message } }
      }
      await recordAppLog({ origem, mensagem: `Falha ao criar ${rotuloIndefinido}.`, detalhes: error })
      return { ok: false, message: "Não foi possível salvar. Verifique a conexão com o banco." }
    }

    revalidar()
    return { ok: true, message: `${rotuloDefinido} "${validado.dados.nome}" cadastrada.` }
  }

  async function atualizar(id: string, input: ItemCatalogoInput): Promise<CatalogoActionResult> {
    const validado = validar(input, rotuloIndefinido)
    if ("erros" in validado) return { ok: false, message: "Corrija os campos destacados.", errors: validado.erros }

    try {
      const atualizado = await servico.atualizar(id, validado.dados)
      if (!atualizado) return { ok: false, message: `${rotuloDefinido} não encontrada.` }
    } catch (error) {
      if (error instanceof ItemCatalogoDuplicadoError) {
        return { ok: false, message: error.message, errors: { nome: error.message } }
      }
      await recordAppLog({ origem, mensagem: `Falha ao atualizar ${rotuloIndefinido} id=${id}.`, detalhes: error })
      return { ok: false, message: "Não foi possível atualizar. Verifique a conexão com o banco." }
    }

    revalidar()
    return { ok: true, message: `${rotuloDefinido} "${validado.dados.nome}" atualizada.` }
  }

  async function excluir(id: string): Promise<CatalogoActionResult> {
    try {
      await servico.excluir(id)
    } catch (error) {
      await recordAppLog({ origem, mensagem: `Falha ao excluir ${rotuloIndefinido} id=${id}.`, detalhes: error })
      return { ok: false, message: "Não foi possível excluir." }
    }

    revalidar()
    return { ok: true, message: `${rotuloDefinido} excluída.` }
  }

  return { criar, atualizar, excluir }
}

const marcas = criarActionsCatalogo(servicoMarcas, "marcas", "uma marca", "Marca")
const personas = criarActionsCatalogo(servicoPersonas, "personas", "uma persona", "Persona")
const regioes = criarActionsCatalogo(servicoRegioes, "regioes", "uma região", "Região")

// Marcas
export async function createMarcaAction(input: ItemCatalogoInput) {
  return marcas.criar(input)
}
export async function updateMarcaAction(id: string, input: ItemCatalogoInput) {
  return marcas.atualizar(id, input)
}
export async function deleteMarcaAction(id: string) {
  return marcas.excluir(id)
}

// Personas
export async function createPersonaAction(input: ItemCatalogoInput) {
  return personas.criar(input)
}
export async function updatePersonaAction(id: string, input: ItemCatalogoInput) {
  return personas.atualizar(id, input)
}
export async function deletePersonaAction(id: string) {
  return personas.excluir(id)
}

// Regiões
export async function createRegiaoAction(input: ItemCatalogoInput) {
  return regioes.criar(input)
}
export async function updateRegiaoAction(id: string, input: ItemCatalogoInput) {
  return regioes.atualizar(id, input)
}
export async function deleteRegiaoAction(id: string) {
  return regioes.excluir(id)
}
