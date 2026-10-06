"use server"

import { revalidatePath } from "next/cache"

import {
  modeloFluxoResposta,
  PAYLOAD_EXEMPLO,
  validarGrafo,
  type FlowEdge,
  type FlowKind,
  type FlowNode,
} from "@/lib/nocode/catalog"
import { recordAppLog } from "@/services/app-logs"
import { ativarBotDoCrm } from "@/services/bots"
import { CrmError } from "@/services/crm"
import {
  createFlow,
  deleteFlow,
  contarExecucoes,
  executarEGravar,
  getFlow,
  listExecutions,
  MSG_FLUXO_SISTEMA_DESATIVAR,
  MSG_FLUXO_SISTEMA_EXCLUIR,
  updateFlow,
  type ExecutionRow,
} from "@/services/nocode"
import {
  atualizarConfigWebhookExecucoes,
  enviarTesteWebhook,
  segredoSalvoDoFluxo,
  validarUrlWebhook,
  type ConfigWebhookExecucoes,
} from "@/services/nocode-webhook-execucoes"
import { assertSecao } from "@/lib/session"

type Resultado<T = object> = ({ ok: true; message: string } & T) | { ok: false; message: string }

const LIMITE_NOME = 80
const LIMITE_NOS = 100

function nomeValido(valor: unknown): string | null {
  const nome = String(valor ?? "").trim()
  return nome && nome.length <= LIMITE_NOME ? nome : null
}

function grafoValido(
  nodes: unknown,
  edges: unknown,
  kind: FlowKind = "automacao",
): { nodes: FlowNode[]; edges: FlowEdge[] } | string {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return "Fluxo inválido."
  if (nodes.length > LIMITE_NOS) return `O fluxo pode ter no máximo ${LIMITE_NOS} blocos.`
  const erro = validarGrafo(nodes as FlowNode[], edges as FlowEdge[], false, kind)
  return erro ?? { nodes: nodes as FlowNode[], edges: edges as FlowEdge[] }
}

async function falha(mensagem: string, error: unknown): Promise<{ ok: false; message: string }> {
  await recordAppLog({ origem: "nocode", mensagem, detalhes: error })
  return { ok: false, message: `${mensagem} Confira se a migration mais recente foi aplicada.` }
}

export async function createFlowAction(input: {
  nome: string
  modelo: "resposta" | "vazio"
}): Promise<Resultado<{ id: string }>> {
  await assertSecao("nocode")
  const nome = nomeValido(input?.nome)
  if (!nome) return { ok: false, message: `Informe um nome de até ${LIMITE_NOME} caracteres.` }

  try {
    const base = input.modelo === "resposta" ? modeloFluxoResposta() : { nodes: [], edges: [] }
    const fluxo = await createFlow({ nome, ...base })
    revalidatePath("/nocode")
    return { ok: true, message: "Fluxo criado.", id: fluxo.id }
  } catch (error) {
    return falha("Não foi possível criar o fluxo.", error)
  }
}

export async function saveFlowAction(
  id: string,
  input: { nome: string; nodes: FlowNode[]; edges: FlowEdge[] },
): Promise<Resultado> {
  await assertSecao("nocode")
  const nome = nomeValido(input?.nome)
  if (!nome) return { ok: false, message: `Informe um nome de até ${LIMITE_NOME} caracteres.` }

  try {
    const atual = await getFlow(id)
    if (!atual) return { ok: false, message: "Fluxo não encontrado." }
    // O tipo do fluxo (automação ou bot) define quais blocos e qual gatilho valem.
    const grafo = grafoValido(input?.nodes, input?.edges, atual.tipo)
    if (typeof grafo === "string") return { ok: false, message: grafo }
    // Um fluxo ativo (e o do sistema, que é sempre ativo) precisa continuar válido (com gatilho) depois da edição.
    if (atual.ativo || atual.sistema) {
      const erro = validarGrafo(grafo.nodes, grafo.edges, true, atual.tipo)
      if (erro) {
        return {
          ok: false,
          message: atual.sistema ? erro : `${erro} Desative o fluxo para salvar assim.`,
        }
      }
    }
    if (atual.sistema) {
      // Sem o token no gatilho a Evolution não consegue mais entregar os eventos.
      const gatilho = grafo.nodes.find((n) => n.type === "webhook")
      if (!String(gatilho?.config?.token ?? "").trim()) {
        return { ok: false, message: "O gatilho Webhook do fluxo de resposta precisa ter um token." }
      }
    }
    await updateFlow(id, { nome, ...grafo })
    revalidatePath("/nocode")
    return { ok: true, message: "Fluxo salvo." }
  } catch (error) {
    return falha("Não foi possível salvar o fluxo.", error)
  }
}

export async function toggleFlowAction(id: string, ativo: boolean): Promise<Resultado<{ ativo: boolean }>> {
  await assertSecao("nocode")
  if (typeof ativo !== "boolean") return { ok: false, message: "Estado inválido." }
  try {
    const fluxo = await getFlow(id)
    if (!fluxo) return { ok: false, message: "Fluxo não encontrado." }
    // O fluxo de resposta do app nunca pode ser desativado.
    if (fluxo.sistema) {
      return ativo
        ? { ok: true, message: "O fluxo de resposta já fica sempre ativo.", ativo: true }
        : { ok: false, message: MSG_FLUXO_SISTEMA_DESATIVAR }
    }
    if (fluxo.tipo === "bot") {
      // Bot: só um ativo por escopo (entrada ou departamento); a regra e a validação ficam no serviço.
      try {
        const { desativados } = await ativarBotDoCrm(id, ativo)
        revalidatePath("/nocode")
        revalidatePath("/crm")
        return {
          ok: true,
          message: !ativo ? "Bot desativado." : desativados > 0 ? "Bot ativado. O outro bot ativo deste escopo foi desativado." : "Bot ativado.",
          ativo,
        }
      } catch (error) {
        if (error instanceof CrmError) return { ok: false, message: error.message }
        throw error
      }
    }
    if (ativo) {
      const erro = validarGrafo(fluxo.nodes, fluxo.edges, true)
      if (erro) return { ok: false, message: erro }
    }
    await updateFlow(id, { ativo })
    revalidatePath("/nocode")
    return { ok: true, message: ativo ? "Fluxo ativado." : "Fluxo desativado.", ativo }
  } catch (error) {
    return falha("Não foi possível alterar o fluxo.", error)
  }
}

export async function deleteFlowAction(id: string): Promise<Resultado> {
  await assertSecao("nocode")
  try {
    const fluxo = await getFlow(id)
    if (!fluxo) return { ok: false, message: "Fluxo não encontrado." }
    // O fluxo de resposta do app nunca pode ser excluído.
    if (fluxo.sistema) return { ok: false, message: MSG_FLUXO_SISTEMA_EXCLUIR }
    await deleteFlow(id)
    revalidatePath("/nocode")
    return { ok: true, message: "Fluxo excluído." }
  } catch (error) {
    return falha("Não foi possível excluir o fluxo.", error)
  }
}

/**
 * Testa o fluxo com um evento de exemplo, usando o que está na tela (mesmo sem
 * salvar). Blocos com efeito real (registrar resposta, enviar mensagem) são
 * apenas simulados; a busca do lead lê o banco de verdade.
 */
export async function testFlowAction(
  id: string,
  input: { nodes: FlowNode[]; edges: FlowEdge[]; payload: string },
): Promise<Resultado<{ execucao: ExecutionRow }>> {
  await assertSecao("nocode")
  const alvo = await getFlow(id).catch(() => null)
  if (!alvo) return { ok: false, message: "Fluxo não encontrado." }
  const grafo = grafoValido(input?.nodes, input?.edges, alvo.tipo)
  if (typeof grafo === "string") return { ok: false, message: grafo }
  const semGatilho = validarGrafo(grafo.nodes, grafo.edges, true, alvo.tipo)
  if (semGatilho) return { ok: false, message: semGatilho }

  let payload: unknown
  try {
    payload = JSON.parse(input.payload)
  } catch {
    return { ok: false, message: "O evento de teste não é um JSON válido." }
  }

  try {
    const execucao = await executarEGravar(id, grafo, payload, "teste", alvo.tipo)
    return { ok: true, message: "Teste executado.", execucao }
  } catch (error) {
    return falha("Não foi possível executar o teste.", error)
  }
}

/** Uma página de execuções (a primeira, ou a seguinte a `depoisDeId`) e o total guardado. */
export async function listExecutionsAction(
  flowId: string,
  depoisDeId?: string,
): Promise<{ itens: ExecutionRow[]; total: number } | null> {
  await assertSecao("nocode")
  try {
    const [itens, total] = await Promise.all([
      listExecutions(flowId, { depoisDeId: typeof depoisDeId === "string" ? depoisDeId : undefined }),
      contarExecucoes(flowId),
    ])
    return { itens, total }
  } catch {
    return null
  }
}

const LIMITE_SEGREDO = 200

/**
 * Liga/desliga o envio de cada execução para um webhook externo.
 * `segredo`: `undefined` mantém o atual, `null` remove, texto define um novo.
 */
export async function salvarWebhookExecucoesAction(
  id: string,
  input: { ativo: boolean; url: string; segredo?: string | null },
): Promise<Resultado<{ config: ConfigWebhookExecucoes }>> {
  await assertSecao("nocode")
  if (typeof input?.ativo !== "boolean") return { ok: false, message: "Estado inválido." }

  const url = String(input.url ?? "").trim()
  let urlFinal = ""
  if (url || input.ativo) {
    const validacao = validarUrlWebhook(url)
    if (!validacao.ok) return { ok: false, message: validacao.erro }
    urlFinal = validacao.url
  }

  let segredo: string | null | undefined
  if (input.segredo === null) segredo = null
  else if (typeof input.segredo === "string" && input.segredo.trim()) {
    segredo = input.segredo.trim()
    if (segredo.length > LIMITE_SEGREDO) return { ok: false, message: `O segredo pode ter no máximo ${LIMITE_SEGREDO} caracteres.` }
  }

  try {
    if (!(await getFlow(id))) return { ok: false, message: "Fluxo não encontrado." }
    const config = await atualizarConfigWebhookExecucoes(id, { ativo: input.ativo, url: urlFinal, segredo })
    revalidatePath("/nocode")
    return {
      ok: true,
      message: input.ativo ? "Webhook de execuções ativado." : "Webhook de execuções desativado.",
      config,
    }
  } catch (error) {
    return falha("Não foi possível salvar o webhook de execuções.", error)
  }
}

/** Envia uma execução de exemplo (marcada como teste) para a URL informada, sem gravar nada. */
export async function testarWebhookExecucoesAction(
  id: string,
  input: { url: string; segredo?: string | null },
): Promise<Resultado> {
  await assertSecao("nocode")
  const validacao = validarUrlWebhook(input?.url)
  if (!validacao.ok) return { ok: false, message: validacao.erro }

  try {
    const fluxo = await getFlow(id)
    if (!fluxo) return { ok: false, message: "Fluxo não encontrado." }
    // Segredo em branco no formulário = usar o já salvo (ele nunca é devolvido à tela).
    const segredo =
      typeof input.segredo === "string" && input.segredo.trim()
        ? input.segredo.trim()
        : input.segredo === null
          ? null
          : await segredoSalvoDoFluxo(id)
    const resultado = await enviarTesteWebhook(
      { url: validacao.url, segredo },
      { entrada: PAYLOAD_EXEMPLO, fluxo: { id: fluxo.id, nome: fluxo.nome, sistema: fluxo.sistema } },
    )
    return resultado.ok ? { ok: true, message: resultado.message } : { ok: false, message: resultado.message }
  } catch (error) {
    return falha("Não foi possível enviar o teste.", error)
  }
}
