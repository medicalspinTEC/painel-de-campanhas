import { prisma } from "@/lib/prisma"
import { renderTemplate } from "@/lib/format"
import { recordAppLog } from "@/services/app-logs"
import { recordMessageEvent } from "@/services/message-events"

export interface EvolutionSendResult {
  ok: boolean
  erro?: string
}

export type EvolutionInstanceState = "conectado" | "conectando" | "desconectado"

export interface EvolutionInstance {
  id: string
  nome: string
  numero?: string
  descricao?: string
  estado: EvolutionInstanceState
  mensagensHoje: number
}

/** Lê a URL base e a apikey global da Evolution a partir do ambiente. */
function getEvolutionCredentials() {
  const apiUrl = (
    process.env.EVOLUTION_API_URL ?? "https://evo-j0o08ok8sgwc4cog04w0owok.95.217.164.173.sslip.io"
  ).replace(/\/$/, "")
  const apiKey = process.env.EVOLUTION_API_KEY?.trim()
  return { apiUrl, apiKey }
}

/** Traduz o status de conexão da Evolution para o vocabulário do painel. */
function mapConnectionStatus(status?: string): EvolutionInstanceState {
  switch (status) {
    case "open":
      return "conectado"
    case "connecting":
      return "conectando"
    default:
      return "desconectado"
  }
}

/**
 * Lista as instâncias existentes na Evolution API (GET /instance/fetchInstances).
 * Devolve lista vazia quando as credenciais não estão configuradas ou a chamada
 * falha, para que a página continue renderizando sem quebrar.
 */
export async function fetchEvolutionInstances(): Promise<EvolutionInstance[]> {
  const { apiUrl, apiKey } = getEvolutionCredentials()
  if (!apiKey) return []

  try {
    const response = await fetch(`${apiUrl}/instance/fetchInstances`, {
      headers: { apikey: apiKey },
      cache: "no-store",
    })

    if (!response.ok) {
      throw new Error(`fetchInstances respondeu com status ${response.status}`)
    }

    const payload = (await response.json()) as unknown
    const lista = Array.isArray(payload) ? payload : []

    return lista.map((entrada) => {
      // Dependendo da versão, o objeto vem "achatado" ou dentro de `instance`.
      const item = (entrada as { instance?: Record<string, unknown> }).instance ?? (entrada as Record<string, unknown>)
      const numeroBruto = (item.ownerJid ?? item.number) as string | undefined
      const profileName = item.profileName as string | undefined
      const contagem = (item._count as { Message?: number } | undefined)?.Message

      return {
        id: String(item.id ?? item.name ?? item.instanceName ?? Math.random().toString(36).slice(2)),
        nome: String(item.name ?? item.instanceName ?? "instância"),
        numero: numeroBruto ? String(numeroBruto).split("@")[0] : undefined,
        descricao: profileName ? `Perfil: ${profileName}` : undefined,
        estado: mapConnectionStatus((item.connectionStatus ?? item.state) as string | undefined),
        mensagensHoje: Number(contagem ?? 0),
      }
    })
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "evolution",
      mensagem: "Falha ao listar instâncias na Evolution API.",
      detalhes: error,
    })
    return []
  }
}

/**
 * Cria uma nova instância na Evolution API (POST /instance/create) usando a
 * integração padrão WHATSAPP-BAILEYS. A conexão (QR Code) é feita em um passo
 * posterior; aqui apenas registramos a instância no servidor.
 */
export async function createEvolutionInstance(input: {
  nome: string
  numero?: string
}): Promise<{ ok: boolean; erro?: string; instancia?: EvolutionInstance }> {
  const { apiUrl, apiKey } = getEvolutionCredentials()
  if (!apiKey) {
    return { ok: false, erro: "EVOLUTION_API_KEY não configurada no ambiente." }
  }

  const nome = input.nome.trim()
  if (!nome) return { ok: false, erro: "Informe um nome para a instância." }

  const numero = input.numero?.replace(/\D/g, "") || undefined

  try {
    const response = await fetch(`${apiUrl}/instance/create`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: apiKey },
      body: JSON.stringify({
        instanceName: nome,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
        ...(numero ? { number: numero } : {}),
      }),
    })

    const payload = (await response.json().catch(() => null)) as
      | { instance?: Record<string, unknown>; message?: unknown; response?: { message?: unknown } }
      | null

    if (!response.ok) {
      const detalhe = payload?.response?.message ?? payload?.message ?? `Evolution respondeu com status ${response.status}`
      const mensagem = Array.isArray(detalhe) ? detalhe.join(", ") : String(detalhe)

      await recordAppLog({
        nivel: "erro",
        origem: "evolution",
        mensagem: `Falha ao criar instância "${nome}" na Evolution API.`,
        detalhes: mensagem,
      })

      return { ok: false, erro: mensagem }
    }

    const inst = payload?.instance ?? {}

    await recordAppLog({
      nivel: "info",
      origem: "evolution",
      mensagem: `Instância "${nome}" criada na Evolution API.`,
    })

    return {
      ok: true,
      instancia: {
        id: String(inst.instanceId ?? inst.instanceName ?? nome),
        nome: String(inst.instanceName ?? nome),
        numero,
        estado: mapConnectionStatus((inst.status as string | undefined) ?? "connecting"),
        mensagensHoje: 0,
      },
    }
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error)
    await recordAppLog({
      nivel: "erro",
      origem: "evolution",
      mensagem: "Exceção ao criar instância na Evolution API.",
      detalhes: error,
    })
    return { ok: false, erro: mensagem }
  }
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
