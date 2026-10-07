import { avaliarAtendimento } from "@/lib/crm-permissoes"
import type { UserRole } from "@/lib/permissoes"
import { prisma } from "@/lib/prisma"
import { CrmError, getContextoAtendimento } from "@/services/crm"
import { assignCampaign } from "@/services/leads"
import { exigirPlugin } from "@/services/settings"

/**
 * Envio de um lead para uma campanha a partir do chat (plugin CRM) ou de um bloco do No Code.
 *
 * É só a porta de entrada com as regras de quem chama: a vinculação em si (status do lead,
 * evento na timeline, webhook `lead.entrou_em_campanha` e disparo da mensagem inicial quando a
 * campanha está ativa) continua sendo feita por `assignCampaign`, a mesma da aba Leads.
 *
 * As recusas de regra de negócio são `CrmError`: o chat mostra a mensagem como está e o bloco
 * do No Code a converte na saída “Não enviado”.
 */

export interface EnvioParaCampanhaResultado {
  leadNome: string
  campanhaNome: string
  campanhaStatus: "ativa" | "pausada" | "rascunho"
  /** Campanha fora do ar: o lead entra, mas nenhuma mensagem sai até ela ser ativada. */
  aguardaAtivacao: boolean
}

export async function enviarLeadParaCampanha(input: {
  leadId: string
  campanhaId: string
  /** Texto do lead em campanhas `individual` (obrigatório nelas, ignorado nas demais). */
  mensagemIndividual?: string | null
  /** Quem enviou, para a nota interna do chat. Ex.: "Maria" ou "o bot “Triagem”". */
  autor: string
}): Promise<EnvioParaCampanhaResultado> {
  const leadId = String(input.leadId ?? "").trim()
  const campanhaId = String(input.campanhaId ?? "").trim()
  if (!leadId) throw new CrmError("Lead não informado.")
  if (!campanhaId) throw new CrmError("Escolha a campanha.")

  const [lead, campanha, vinculo] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, nome: true } }),
    prisma.campaign.findUnique({ where: { id: campanhaId }, select: { id: true, nome: true, status: true, tipo: true } }),
    prisma.leadCampaign.findUnique({ where: { leadId_campanhaId: { leadId, campanhaId } }, select: { leadId: true } }),
  ])
  if (!lead) throw new CrmError("Lead não encontrado.")
  if (!campanha) throw new CrmError("Campanha não encontrada.")
  if (campanha.status === "encerrada") throw new CrmError(`A campanha “${campanha.nome}” está encerrada.`)
  if (vinculo) throw new CrmError(`${lead.nome} já está na campanha “${campanha.nome}”.`)

  const mensagemIndividual = input.mensagemIndividual?.trim() || null
  if (campanha.tipo === "individual" && !mensagemIndividual) {
    throw new CrmError(`A campanha “${campanha.nome}” é individual: informe a mensagem que este lead vai receber.`)
  }

  await assignCampaign(lead.id, campanha.id, campanha.tipo === "individual" ? mensagemIndividual : null)

  // A equipe vê no chat que o lead entrou numa campanha (e por quem). Nunca derruba o envio.
  try {
    await prisma.chatInternalNote.create({
      data: { leadId: lead.id, texto: `Lead enviado para a campanha “${campanha.nome}” por ${input.autor}.` },
    })
  } catch (error) {
    console.error("[campanha] falha ao registrar a nota interna do envio", error)
  }

  return {
    leadNome: lead.nome,
    campanhaNome: campanha.nome,
    campanhaStatus: campanha.status,
    aguardaAtivacao: campanha.status !== "ativa",
  }
}

/**
 * Envio feito por uma pessoa no chat. Exige o plugin CRM e respeita as regras de atendimento:
 * só quem pode responder a conversa (responsável, atendente do departamento ou admin) move o
 * lead de campanha — o mesmo critério de enviar mensagem e de pausar o bot.
 */
export async function enviarLeadParaCampanhaPeloChat(
  leadId: string,
  campanhaId: string,
  mensagemIndividual: string | null | undefined,
  executor: { id: string; nome: string; role: UserRole },
): Promise<EnvioParaCampanhaResultado> {
  await exigirPlugin("crm")

  const [atual, ctx] = await Promise.all([
    prisma.leadAtendimento.findUnique({
      where: { leadId },
      select: {
        departamentoId: true,
        atendenteId: true,
        departamento: { select: { nome: true } },
        atendente: { select: { user: { select: { nome: true } } } },
      },
    }),
    getContextoAtendimento(executor),
  ])

  const permissoes = avaliarAtendimento(
    atual
      ? {
          departamentoId: atual.departamentoId,
          atendenteId: atual.atendenteId,
          departamentoNome: atual.departamento?.nome ?? null,
          atendenteNome: atual.atendente?.user.nome ?? null,
        }
      : null,
    ctx,
  )
  if (!permissoes.podeEnviar) {
    throw new CrmError(permissoes.motivo ?? "Você não pode enviar este lead para uma campanha.")
  }

  return enviarLeadParaCampanha({ leadId, campanhaId, mensagemIndividual, autor: executor.nome })
}
