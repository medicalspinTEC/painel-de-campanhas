import { prisma } from "@/lib/prisma"
import { renderTemplate } from "@/lib/format"
import { recordAppLog } from "@/services/app-logs"
import { recordMessageEvent } from "@/services/message-events"

export interface EvolutionSendResult {
  ok: boolean
  erro?: string
}

function normalizePhoneForEvolution(value: string): string {
  const telefone = value.trim()
  if (!telefone) return ""

  if (telefone.includes("@")) return telefone

  const compact = telefone.replace(/[^\d+]/g, "")
  if (compact.startsWith("+")) return compact

  return compact.replace(/\D/g, "")
}

async function shouldSendMessage(leadId: string, campanhaId: string, mensagemId: string): Promise<boolean> {
  /*
   * A dedupe evita reenviar a mesma mensagem ao lead dentro do mesmo ciclo da
   * campanha. Definimos um "corte" a partir do qual os envios contam, usando o
   * mais recente entre dois marcos:
   *   - `reiniciadaEm`: último (re)início da campanha inteira;
   *   - `LeadCampaign.criadoEm`: quando o lead foi vinculado no vínculo atual.
   * Assim, tanto reiniciar a campanha quanto desvincular/revincular um lead
   * (que recria a linha com `criadoEm` novo) liberam o reenvio. Sem nenhum dos
   * marcos (dados antigos), a dedupe considera todo o histórico.
   */
  const [campanha, vinculo] = await Promise.all([
    prisma.campaign.findUnique({
      where: { id: campanhaId },
      select: { reiniciadaEm: true },
    }),
    prisma.leadCampaign.findUnique({
      where: { leadId_campanhaId: { leadId, campanhaId } },
      select: { criadoEm: true, cicloReiniciadoEm: true },
    }),
  ])

  const marcos = [campanha?.reiniciadaEm, vinculo?.criadoEm, vinculo?.cicloReiniciadoEm].filter(Boolean) as Date[]
  const corte = marcos.length ? new Date(Math.max(...marcos.map((d) => d.getTime()))) : null

  const jaEnviada = await prisma.timelineEvent.findFirst({
    where: {
      leadId,
      campanhaId,
      mensagemId,
      tipo: "mensagem_enviada",
      ...(corte ? { data: { gte: corte } } : {}),
    },
    select: { id: true },
  })

  return !jaEnviada
}

export async function sendCampaignMessageToLead(input: {
  leadId: string
  campanhaId: string
  mensagemId: string
  texto: string
  telefone: string
  /** Descrição registrada na timeline em caso de sucesso. */
  descricaoSucesso?: string
  /** Descrição registrada na timeline em caso de falha. */
  descricaoFalha?: string
}): Promise<EvolutionSendResult> {
  const descricaoSucesso = input.descricaoSucesso ?? "Mensagem inicial da campanha enviada via Evolution."
  const descricaoFalha = input.descricaoFalha ?? "Falha ao enviar mensagem da campanha via Evolution."
  const apiUrl = (process.env.EVOLUTION_API_URL ?? "https://evo-j0o08ok8sgwc4cog04w0owok.95.217.164.173.sslip.io").replace(/\/$/, "")
  const apiKey = process.env.EVOLUTION_API_KEY?.trim()
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME?.trim()

  if (!instanceName || !apiKey) {
    const mensagem = "Credenciais da Evolution não configuradas (EVOLUTION_API_KEY ou EVOLUTION_INSTANCE_NAME ausentes)."
    await recordAppLog({
      nivel: "critico",
      origem: "evolution",
      mensagem,
      detalhes: `leadId=${input.leadId} campanhaId=${input.campanhaId}`,
    })
    return { ok: false, erro: mensagem }
  }

  const telefone = normalizePhoneForEvolution(input.telefone)
  if (!telefone) {
    const mensagem = "Número de telefone inválido para envio."
    await recordAppLog({
      nivel: "aviso",
      origem: "evolution",
      mensagem,
      detalhes: `telefone original="${input.telefone}" leadId=${input.leadId}`,
    })
    return { ok: false, erro: mensagem }
  }

  const podeEnviar = await shouldSendMessage(input.leadId, input.campanhaId, input.mensagemId)
  if (!podeEnviar) {
    return { ok: true }
  }

  // Personaliza o texto para este lead (ex.: {{primeiro_nome}}) no momento do
  // envio, usando a MESMA resolução do preview do editor (`renderTemplate`), para
  // que todas as origens (engine, "Pular" e envio manual) fiquem consistentes.
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { nome: true },
  })
  const texto = renderTemplate(input.texto, lead?.nome?.trim() || "")

  try {
    const response = await fetch(`${apiUrl}/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: apiKey,
      },
      body: JSON.stringify({
        number: telefone,
        text: texto,
      }),
    })

    if (!response.ok) {
      const detalhe = await response.text()
      const mensagem = detalhe || `Evolution respondeu com status ${response.status}`

      await Promise.all([
        recordMessageEvent({
          kind: "falha",
          leadId: input.leadId,
          campanhaId: input.campanhaId,
          mensagemId: input.mensagemId,
          descricao: descricaoFalha,
          detalhes: mensagem,
        }),
        recordAppLog({
          nivel: "erro",
          origem: "evolution",
          mensagem: `Evolution retornou HTTP ${response.status}`,
          detalhes: mensagem,
        }),
      ])

      return { ok: false, erro: mensagem }
    }

    await recordMessageEvent({
      kind: "enviada",
      leadId: input.leadId,
      campanhaId: input.campanhaId,
      mensagemId: input.mensagemId,
      descricao: descricaoSucesso,
      detalhes: `Enviada para ${telefone}`,
    })

    return { ok: true }
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error)

    await Promise.all([
      recordMessageEvent({
        kind: "falha",
        leadId: input.leadId,
        campanhaId: input.campanhaId,
        mensagemId: input.mensagemId,
        descricao: descricaoFalha,
        detalhes: mensagem,
      }),
      recordAppLog({
        nivel: "erro",
        origem: "evolution",
        mensagem: "Exceção ao chamar a Evolution API.",
        detalhes: error,
      }),
    ])

    return { ok: false, erro: mensagem }
  }
}
