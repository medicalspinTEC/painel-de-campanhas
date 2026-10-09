"use server"

import { revalidatePath } from "next/cache"

import {
  createCampaign,
  createFollowUpCampaign,
  deleteCampaign,
  duplicateCampaign,
  setCampaignStatus,
  skipToNextMessage,
  updateCampaign,
  type CampaignInput,
} from "@/services/campaigns"
import { recordAppLog } from "@/services/app-logs"
import type { CampanhaAnexo, CampaignStatus } from "@/types"
import { assertSecao } from "@/lib/session"
import { prismaGlobal } from "@/lib/prisma"
import { mimeLimpo, nomeSeguro } from "@/lib/arquivo-storage"
import {
  CAMPANHA_ANEXO_TAMANHO_MAXIMO,
  idDeAnexoValido,
  removerAnexoCampanha,
  salvarAnexoCampanha,
  tamanhoDoAnexoCampanha,
  tipoDoAnexo,
} from "@/lib/campanha-anexo-storage"

export interface CampaignActionResult {
  ok: boolean
  message: string
  id?: string
  errors?: Record<string, string>
}

function revalidar(id?: string) {
  revalidatePath("/campanhas")
  revalidatePath("/dashboard")
  revalidatePath("/leads")
  revalidatePath("/relatorios")
  if (id) revalidatePath(`/campanhas/${id}`)
}

function validar(input: CampaignInput) {
  const errors: Record<string, string> = {}
  if (input.nome.trim().length < 3) errors.nome = "Dê um nome com pelo menos 3 caracteres."

  if ((input.tipo ?? "padrao") === "individual") {
    const leadIds = [...new Set((input.leadIds ?? []).filter(Boolean))]
    // Leads só são exigidos para ATIVAR a campanha (aqui, quando ela já é
    // salva com status "ativa"). Criar ou manter como rascunho/pausada não
    // exige nenhum lead vinculado ainda — é o que permite, por exemplo,
    // criar a campanha individual primeiro e só depois importar os leads
    // (com a coluna "mensagem" da importação) antes de ativá-la.
    if (input.status === "ativa") {
      if (leadIds.length === 0) errors.leadIds = "Selecione pelo menos um lead para ativar a campanha individual."
      const mensagens = input.leadMensagens ?? {}
      const semMensagem = leadIds.some((id) => (mensagens[id] ?? "").trim().length < 10)
      if (semMensagem) errors.mensagens = "Escreva uma mensagem com pelo menos 10 caracteres para cada lead selecionado."
    } else if (leadIds.length > 0) {
      // Se leads já foram selecionados manualmente (mesmo em rascunho),
      // mantemos a exigência de mensagem para quem foi selecionado — evita
      // salvar um vínculo que nunca vai disparar nada.
      const mensagens = input.leadMensagens ?? {}
      const semMensagem = leadIds.some((id) => (mensagens[id] ?? "").trim().length < 10)
      if (semMensagem) errors.mensagens = "Escreva uma mensagem com pelo menos 10 caracteres para cada lead selecionado."
    }
    return errors
  }

  // Campanha padrão: mesma regra — leads não são exigidos para criar ou
  // salvar a campanha, só passam a importar quando ela é ativada (e podem
  // chegar depois, por filtro ou importação).
  if (input.recorrenciaDias < 1) errors.recorrenciaDias = "A recorrência mínima é de 1 dia."
  if (input.mensagens.length === 0) errors.mensagens = "Adicione pelo menos uma mensagem na sequência."
  // Mensagem com imagem/vídeo/arquivo pode ir sem texto (a mídia é o conteúdo); sem mídia, mínimo de 10 caracteres.
  if (input.mensagens.some((m) => !m.anexo && m.texto.trim().length < 10))
    errors.mensagens = "Todas as mensagens precisam ter no mínimo 10 caracteres (ou uma imagem/arquivo anexado)."
  return errors
}

/**
 * O navegador só informa a referência do anexo; tipo, mime, nome e tamanho são refeitos aqui a
 * partir do que de fato está no servidor. Referência inválida ou arquivo sumido => sem anexo.
 */
async function sanearAnexos(input: CampaignInput): Promise<CampaignInput> {
  const mensagens = await Promise.all(
    input.mensagens.map(async (m) => {
      const anexo = m.anexo
      if (!anexo || !idDeAnexoValido(anexo.id)) return { ...m, anexo: null }
      const tamanho = await tamanhoDoAnexoCampanha(anexo.id)
      if (tamanho === null) return { ...m, anexo: null }
      const mime = mimeLimpo(anexo.mime)
      const limpo: CampanhaAnexo = {
        id: anexo.id,
        tipo: tipoDoAnexo(mime),
        mime,
        nome: nomeSeguro(anexo.nome, "arquivo"),
        tamanho,
      }
      return { ...m, anexo: limpo }
    }),
  )
  return { ...input, mensagens }
}

/**
 * Envia a imagem, o vídeo ou o arquivo de UMA mensagem da campanha. O conteúdo vai para uma pasta do
 * servidor (nunca para o banco) e fica lá até a mensagem ser removida ou a campanha excluída; o
 * painel não mostra pré-visualização. Recebe um FormData com `arquivo`; devolve a referência a ser
 * enviada de volta ao salvar a campanha.
 */
export async function uploadCampaignAnexoAction(
  formData: FormData,
): Promise<{ ok: true; anexo: CampanhaAnexo } | { ok: false; message: string }> {
  await assertSecao("campanhas")

  const arquivo = formData.get("arquivo")
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false, message: "Nenhum arquivo foi recebido. Escolha o arquivo novamente." }
  }
  if (arquivo.size > CAMPANHA_ANEXO_TAMANHO_MAXIMO) {
    return {
      ok: false,
      message: `O arquivo é muito grande (máximo de ${Math.round(CAMPANHA_ANEXO_TAMANHO_MAXIMO / 1024 / 1024)} MB).`,
    }
  }

  try {
    const anexo = await salvarAnexoCampanha(Buffer.from(await arquivo.arrayBuffer()), {
      nome: arquivo.name,
      mime: arquivo.type,
    })
    return { ok: true, anexo }
  } catch (error) {
    await recordAppLog({ origem: "campaigns", mensagem: "Falha ao guardar o anexo da campanha no servidor.", detalhes: error })
    return {
      ok: false,
      message: "Não foi possível guardar o arquivo no servidor. Verifique o volume da pasta de anexos (CAMPANHA_ANEXO_DIR) e suas permissões.",
    }
  }
}

/** Descarta um arquivo recém-enviado que ainda não foi salvo em nenhuma campanha (ex.: o usuário trocou o anexo). */
export async function descartarAnexoNovoAction(id: string): Promise<void> {
  await assertSecao("campanhas")
  // Só apaga se nenhuma mensagem salva o referencia: um anexo já salvo só sai pela edição da campanha.
  // `prismaGlobal`: a checagem vale para todas as instâncias, não só a do usuário.
  const emUso = await prismaGlobal.campaignMessage.count({ where: { anexoId: id } })
  if (emUso === 0) await removerAnexoCampanha(id)
}

export async function createCampaignAction(bruto: CampaignInput): Promise<CampaignActionResult> {
  await assertSecao("campanhas")
  const input = await sanearAnexos(bruto)
  const errors = validar(input)
  if (Object.keys(errors).length > 0) return { ok: false, message: "Corrija os campos destacados.", errors }
  try {
    const campanha = await createCampaign(input)
    revalidar(campanha.id)
    return { ok: true, message: `Campanha ${campanha.nome} criada.`, id: campanha.id }
  } catch (error) {
    await recordAppLog({ origem: "campaigns", mensagem: "Falha ao criar campanha.", detalhes: error })
    return { ok: false, message: "Não foi possível criar a campanha. Verifique a conexão com o banco." }
  }
}

export async function updateCampaignAction(id: string, bruto: CampaignInput): Promise<CampaignActionResult> {
  await assertSecao("campanhas")
  const input = await sanearAnexos(bruto)
  const errors = validar(input)
  if (Object.keys(errors).length > 0) return { ok: false, message: "Corrija os campos destacados.", errors }
  try {
    const campanha = await updateCampaign(id, input)
    if (!campanha) return { ok: false, message: "Campanha não encontrada." }
    revalidar(id)
    return { ok: true, message: `Campanha ${campanha.nome} atualizada.`, id }
  } catch (error) {
    await recordAppLog({ origem: "campaigns", mensagem: `Falha ao atualizar campanha id=${id}.`, detalhes: error })
    return { ok: false, message: "Não foi possível atualizar a campanha." }
  }
}

export async function setCampaignStatusAction(id: string, status: CampaignStatus): Promise<CampaignActionResult> {
  await assertSecao("campanhas")
  try {
    const campanha = await setCampaignStatus(id, status)
    if (!campanha) return { ok: false, message: "Campanha não encontrada." }
    revalidar(id)
    return { ok: true, message: `Campanha ${campanha.nome} agora está ${status}.` }
  } catch (error) {
    await recordAppLog({ origem: "campaigns", mensagem: `Falha ao mudar status da campanha id=${id} para "${status}".`, detalhes: error })
    return { ok: false, message: "Não foi possível alterar o status da campanha." }
  }
}

export interface SkipMessageActionResult {
  ok: boolean
  message: string
  aguardandoRecorrencia?: boolean
}

export async function skipCampaignMessageAction(
  leadId: string,
  campanhaId: string,
): Promise<SkipMessageActionResult> {
  await assertSecao("campanhas")
  try {
    const resultado = await skipToNextMessage(leadId, campanhaId)
    if (resultado.ok) {
      revalidar(campanhaId)
      revalidatePath(`/leads/${leadId}`)
    }
    return { ok: resultado.ok, message: resultado.message, aguardandoRecorrencia: resultado.aguardandoRecorrencia }
  } catch (error) {
    await recordAppLog({
      origem: "campaigns",
      mensagem: `Falha ao pular mensagem do lead ${leadId} na campanha ${campanhaId}.`,
      detalhes: error,
    })
    return { ok: false, message: "Não foi possível enviar a próxima mensagem." }
  }
}

export async function duplicateCampaignAction(id: string): Promise<CampaignActionResult> {
  await assertSecao("campanhas")
  try {
    const copia = await duplicateCampaign(id)
    if (!copia) return { ok: false, message: "Campanha não encontrada." }
    revalidar()
    return { ok: true, message: `Campanha duplicada como rascunho.`, id: copia.id }
  } catch (error) {
    await recordAppLog({ origem: "campaigns", mensagem: `Falha ao duplicar campanha id=${id}.`, detalhes: error })
    return { ok: false, message: "Não foi possível duplicar a campanha." }
  }
}

export async function createFollowUpCampaignAction(id: string): Promise<CampaignActionResult> {
  await assertSecao("campanhas")
  try {
    const resultado = await createFollowUpCampaign(id)
    if (!resultado) {
      return {
        ok: false,
        message: "Só é possível criar essa campanha a partir de uma campanha encerrada com leads que não responderam.",
      }
    }
    revalidar(resultado.campanhaId)
    const total = resultado.leadIds.length
    return {
      ok: true,
      message: `Campanha criada como rascunho com ${total} ${total === 1 ? "lead que não respondeu" : "leads que não responderam"}.`,
      id: resultado.campanhaId,
    }
  } catch (error) {
    await recordAppLog({
      origem: "campaigns",
      mensagem: `Falha ao criar campanha de reengajamento a partir da campanha id=${id}.`,
      detalhes: error,
    })
    return { ok: false, message: "Não foi possível criar a nova campanha." }
  }
}

export async function deleteCampaignAction(id: string): Promise<CampaignActionResult> {
  await assertSecao("campanhas")
  try {
    await deleteCampaign(id)
  } catch (error) {
    await recordAppLog({ origem: "campaigns", mensagem: `Falha ao excluir campanha id=${id}.`, detalhes: error })
    return { ok: false, message: "Não foi possível excluir a campanha." }
  }
  revalidar()
  return { ok: true, message: "Campanha excluída e leads liberados." }
}
