"use server"

import { revalidatePath } from "next/cache"

import type { FunilBoardData } from "@/lib/funis"
import { PluginDesativadoError } from "@/lib/plugins"
import { assertPoder, assertSecao, ForbiddenError } from "@/lib/session"
import { recordAppLog } from "@/services/app-logs"
import { CrmError } from "@/services/crm"
import {
  adicionarLeadAoFunil,
  adicionarLeadsAoFunil,
  atualizarFunil,
  buscarLeadsParaFunil,
  criarFunil,
  definirValorNoFunil,
  excluirFunil,
  getFunilBoard,
  listarFunisParaAdicionar,
  moverLeadNoFunil,
  removerLeadDoFunil,
  salvarEtapas,
  type EtapaInput,
  type FunilInput,
  type FunilParaAdicionar,
} from "@/services/funis"
import { getCrmPluginAtivo } from "@/services/settings"

export type FunilActionResult = { ok: boolean; message: string }

function falha(error: unknown, contexto: string): FunilActionResult {
  if (error instanceof CrmError || error instanceof ForbiddenError || error instanceof PluginDesativadoError) {
    return { ok: false, message: error.message }
  }
  void recordAppLog({ origem: "crm", mensagem: contexto, detalhes: error })
  return { ok: false, message: contexto }
}

/** Funis fazem parte da gestão do CRM: root ou admin com o poder "Gerenciar o CRM", e só com o plugin ativo. */
async function exigirGestaoCrm() {
  const usuario = await assertPoder("crm_gerenciar")
  if (!(await getCrmPluginAtivo())) throw new CrmError("O plugin CRM está desativado.")
  return usuario
}

/**
 * Operações sobre UM lead no funil (colocar, mover, valor, remover): além de quem gerencia o CRM,
 * liberadas a quem usa as telas de Leads ou Chat, que têm esses atalhos. Editar funis e etapas
 * continua só com o poder "Gerenciar o CRM".
 */
async function exigirAcessoLeadFunil() {
  const usuario = await assertSecao("leads", "chat")
  if (!(await getCrmPluginAtivo())) throw new CrmError("O plugin CRM está desativado.")
  return usuario
}

function revalidarFunis() {
  revalidatePath("/crm")
}

export async function carregarFunilAction(funilId: string): Promise<{ ok: boolean; message: string; board?: FunilBoardData }> {
  try {
    await exigirGestaoCrm()
    const board = await getFunilBoard(funilId)
    if (!board) return { ok: false, message: "Funil não encontrado." }
    return { ok: true, message: "", board }
  } catch (error) {
    return falha(error, "Não foi possível carregar o funil.")
  }
}

export async function criarFunilAction(input: FunilInput): Promise<FunilActionResult & { id?: string }> {
  try {
    await exigirGestaoCrm()
    const { id } = await criarFunil(input)
    revalidarFunis()
    return { ok: true, message: "Funil criado com as etapas padrão.", id }
  } catch (error) {
    return falha(error, "Não foi possível criar o funil.")
  }
}

export async function atualizarFunilAction(id: string, input: FunilInput): Promise<FunilActionResult> {
  try {
    await exigirGestaoCrm()
    await atualizarFunil(id, input)
  } catch (error) {
    return falha(error, "Não foi possível salvar o funil.")
  }
  revalidarFunis()
  return { ok: true, message: "Funil atualizado." }
}

export async function excluirFunilAction(id: string): Promise<FunilActionResult> {
  try {
    await exigirGestaoCrm()
    const { leads } = await excluirFunil(id)
    revalidarFunis()
    return {
      ok: true,
      message: leads > 0 ? `Funil excluído. ${leads} ${leads === 1 ? "lead saiu" : "leads saíram"} do funil (os cadastros foram mantidos).` : "Funil excluído.",
    }
  } catch (error) {
    return falha(error, "Não foi possível excluir o funil.")
  }
}

export async function salvarEtapasFunilAction(funilId: string, etapas: EtapaInput[], destinoId: string | null): Promise<FunilActionResult> {
  try {
    const usuario = await exigirGestaoCrm()
    const { movidos } = await salvarEtapas(funilId, etapas, destinoId, usuario.nome)
    revalidarFunis()
    return {
      ok: true,
      message: movidos > 0 ? `Etapas salvas. ${movidos} ${movidos === 1 ? "lead foi movido" : "leads foram movidos"}.` : "Etapas salvas.",
    }
  } catch (error) {
    return falha(error, "Não foi possível salvar as etapas.")
  }
}

export async function buscarLeadsFunilAction(
  funilId: string,
  termo: string,
): Promise<{ ok: boolean; message: string; leads: { id: string; nome: string; telefone: string }[] }> {
  try {
    await exigirGestaoCrm()
    return { ok: true, message: "", leads: await buscarLeadsParaFunil(funilId, termo) }
  } catch (error) {
    return { ...falha(error, "Não foi possível buscar os leads."), leads: [] }
  }
}

export async function adicionarLeadAoFunilAction(
  funilId: string,
  leadId: string,
  opcoes: { etapaId?: string | null; valor?: number | null } = {},
): Promise<FunilActionResult> {
  try {
    const usuario = await exigirAcessoLeadFunil()
    await adicionarLeadAoFunil(funilId, leadId, opcoes, usuario.nome)
  } catch (error) {
    return falha(error, "Não foi possível adicionar o lead ao funil.")
  }
  revalidarFunis()
  revalidatePath(`/leads/${leadId}`)
  return { ok: true, message: "Lead adicionado ao funil." }
}

export async function moverLeadNoFunilAction(funilId: string, leadId: string, etapaId: string): Promise<FunilActionResult> {
  try {
    const usuario = await exigirAcessoLeadFunil()
    const { etapaNome } = await moverLeadNoFunil(funilId, leadId, etapaId, usuario.nome)
    // O quadro já foi atualizado no cliente; /crm fica de fora para não recarregar no meio de outro arrasto.
    revalidatePath(`/leads/${leadId}`)
    return { ok: true, message: `Lead movido para ${etapaNome}.` }
  } catch (error) {
    return falha(error, "Não foi possível mover o lead.")
  }
}

export async function definirValorFunilAction(funilId: string, leadId: string, valor: number | null): Promise<FunilActionResult> {
  try {
    await exigirAcessoLeadFunil()
    await definirValorNoFunil(funilId, leadId, valor)
    return { ok: true, message: valor === null ? "Valor removido." : "Valor atualizado." }
  } catch (error) {
    return falha(error, "Não foi possível salvar o valor.")
  }
}

export async function removerLeadDoFunilAction(funilId: string, leadId: string): Promise<FunilActionResult> {
  try {
    const usuario = await exigirAcessoLeadFunil()
    await removerLeadDoFunil(funilId, leadId, usuario.nome)
  } catch (error) {
    return falha(error, "Não foi possível remover o lead do funil.")
  }
  revalidarFunis()
  revalidatePath(`/leads/${leadId}`)
  return { ok: true, message: "Lead removido do funil." }
}

export async function listarFunisParaAdicionarAction(): Promise<{ ok: boolean; message: string; funis: FunilParaAdicionar[] }> {
  try {
    await exigirAcessoLeadFunil()
    return { ok: true, message: "", funis: await listarFunisParaAdicionar() }
  } catch (error) {
    return { ...falha(error, "Não foi possível carregar os funis."), funis: [] }
  }
}

/** Coloca um ou vários leads no funil (chat, detalhe do lead e aba Leads). */
export async function adicionarLeadsAoFunilAction(
  funilId: string,
  leadIds: string[],
  opcoes: { etapaId?: string | null; valor?: number | null } = {},
): Promise<FunilActionResult> {
  try {
    const usuario = await exigirAcessoLeadFunil()
    const { adicionados, jaNoFunil } = await adicionarLeadsAoFunil(funilId, leadIds, opcoes, usuario.nome)
    revalidarFunis()
    revalidatePath("/leads")
    for (const id of leadIds.slice(0, 20)) revalidatePath(`/leads/${id}`)
    if (adicionados === 0) return { ok: false, message: jaNoFunil === 1 ? "Este lead já está no funil." : "Todos os leads selecionados já estão no funil." }
    const base = adicionados === 1 ? "1 lead adicionado ao funil." : `${adicionados} leads adicionados ao funil.`
    return { ok: true, message: jaNoFunil > 0 ? `${base} ${jaNoFunil} já ${jaNoFunil === 1 ? "estava" : "estavam"} nele.` : base }
  } catch (error) {
    return falha(error, "Não foi possível adicionar ao funil.")
  }
}
