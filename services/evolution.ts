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

  // Nomes das instâncias criadas por este painel. Só essas serão exibidas.
  let nomesDoApp: Set<string>
  try {
    const registradas = await prisma.instance.findMany({ select: { nome: true } })
    nomesDoApp = new Set(registradas.map((i) => i.nome))
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "evolution",
      mensagem: "Falha ao consultar as instâncias registradas no banco do painel.",
      detalhes: error,
    })
    return []
  }

  // Sem instâncias registradas, não há o que buscar na Evolution.
  if (nomesDoApp.size === 0) return []

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

    return lista
      .map((entrada) => {
        // Dependendo da versão, o objeto vem "achatado" ou dentro de `instance`.
        const item =
          (entrada as { instance?: Record<string, unknown> }).instance ?? (entrada as Record<string, unknown>)
        const numeroBruto = (item.ownerJid ?? item.number) as string | undefined
        const profileName = item.profileName as string | undefined
        const contagem = (item._count as { Message?: number } | undefined)?.Message
        const nome = String(item.name ?? item.instanceName ?? "instância")

        return {
          id: String(item.id ?? item.name ?? item.instanceName ?? Math.random().toString(36).slice(2)),
          nome,
          numero: numeroBruto ? String(numeroBruto).split("@")[0] : undefined,
          descricao: profileName ? `Perfil: ${profileName}` : undefined,
          estado: mapConnectionStatus((item.connectionStatus ?? item.state) as string | undefined),
          mensagensHoje: Number(contagem ?? 0),
        }
      })
      // Mantém somente as instâncias criadas por este painel.
      .filter((instancia) => nomesDoApp.has(instancia.nome))
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

    // Registra a instância no banco para que a listagem mostre apenas as que
    // foram criadas por este painel (a Evolution pode hospedar outras).
    try {
      await prisma.instance.upsert({
        where: { nome },
        update: { numero: numero ?? null },
        create: { nome, numero: numero ?? null },
      })
    } catch (error) {
      await recordAppLog({
        nivel: "aviso",
        origem: "evolution",
        mensagem: `Instância "${nome}" criada na Evolution, mas não registrada no banco do painel.`,
        detalhes: error,
      })
    }

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

export interface EvolutionConnectResult {
  ok: boolean
  erro?: string
  /** QR Code já pronto para uso em <img src=...> (com prefixo data:image). */
  qrCode?: string
  /** Código de pareamento por número (quando a instância foi criada com `number`). */
  pairingCode?: string
  /** Código textual do QR (fallback). */
  code?: string
  /** Quando a instância já está conectada, a Evolution não devolve QR. */
  jaConectada?: boolean
}

/**
 * Inicia o pareamento de uma instância (GET /instance/connect/{nome}).
 * Devolve o QR Code em base64 (e/ou o pairing code) para exibir ao usuário.
 * Quando a instância já está conectada, a Evolution normalmente responde sem
 * QR — nesse caso sinalizamos `jaConectada` para o cliente fechar o diálogo.
 */
export async function connectEvolutionInstance(nome: string): Promise<EvolutionConnectResult> {
  const { apiUrl, apiKey } = getEvolutionCredentials()
  if (!apiKey) return { ok: false, erro: "EVOLUTION_API_KEY não configurada no ambiente." }

  const instancia = nome.trim()
  if (!instancia) return { ok: false, erro: "Nome da instância ausente." }

  try {
    const response = await fetch(`${apiUrl}/instance/connect/${encodeURIComponent(instancia)}`, {
      headers: { apikey: apiKey },
      cache: "no-store",
    })

    const payload = (await response.json().catch(() => null)) as
      | {
          base64?: string
          code?: string
          pairingCode?: string
          count?: number
          instance?: { state?: string }
          message?: unknown
          response?: { message?: unknown }
        }
      | null

    if (!response.ok) {
      const detalhe =
        payload?.response?.message ?? payload?.message ?? `Evolution respondeu com status ${response.status}`
      const mensagem = Array.isArray(detalhe) ? detalhe.join(", ") : String(detalhe)
      await recordAppLog({
        nivel: "erro",
        origem: "evolution",
        mensagem: `Falha ao conectar instância "${instancia}".`,
        detalhes: mensagem,
      })
      return { ok: false, erro: mensagem }
    }

    const base64 = payload?.base64
    if (!base64 && !payload?.pairingCode && !payload?.code) {
      // Sem QR e sem código costuma indicar instância já conectada.
      return { ok: true, jaConectada: true }
    }

    // A Evolution ora devolve o base64 puro, ora já com o prefixo data URI.
    const qrCode = base64
      ? base64.startsWith("data:")
        ? base64
        : `data:image/png;base64,${base64}`
      : undefined

    return {
      ok: true,
      qrCode,
      pairingCode: payload?.pairingCode,
      code: payload?.code,
    }
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error)
    await recordAppLog({
      nivel: "erro",
      origem: "evolution",
      mensagem: `Exceção ao conectar instância "${instancia}".`,
      detalhes: error,
    })
    return { ok: false, erro: mensagem }
  }
}

/**
 * Consulta o estado atual da conexão (GET /instance/connectionState/{nome}).
 * Usado no polling do diálogo de QR Code para detectar quando o WhatsApp foi
 * pareado (estado "open").
 */
export async function getEvolutionConnectionState(
  nome: string,
): Promise<{ ok: boolean; erro?: string; estado?: EvolutionInstanceState }> {
  const { apiUrl, apiKey } = getEvolutionCredentials()
  if (!apiKey) return { ok: false, erro: "EVOLUTION_API_KEY não configurada no ambiente." }

  const instancia = nome.trim()
  if (!instancia) return { ok: false, erro: "Nome da instância ausente." }

  try {
    const response = await fetch(`${apiUrl}/instance/connectionState/${encodeURIComponent(instancia)}`, {
      headers: { apikey: apiKey },
      cache: "no-store",
    })

    if (!response.ok) {
      return { ok: false, erro: `Evolution respondeu com status ${response.status}` }
    }

    const payload = (await response.json().catch(() => null)) as
      | { instance?: { state?: string }; state?: string }
      | null

    const state = payload?.instance?.state ?? payload?.state
    return { ok: true, estado: mapConnectionStatus(state) }
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error)
    return { ok: false, erro: mensagem }
  }
}

/** Desconecta o WhatsApp da instância (DELETE /instance/logout/{nome}). */
export async function logoutEvolutionInstance(nome: string): Promise<{ ok: boolean; erro?: string }> {
  const { apiUrl, apiKey } = getEvolutionCredentials()
  if (!apiKey) return { ok: false, erro: "EVOLUTION_API_KEY não configurada no ambiente." }

  const instancia = nome.trim()
  if (!instancia) return { ok: false, erro: "Nome da instância ausente." }

  try {
    const response = await fetch(`${apiUrl}/instance/logout/${encodeURIComponent(instancia)}`, {
      method: "DELETE",
      headers: { apikey: apiKey },
      cache: "no-store",
    })

    if (!response.ok) {
      const detalhe = await response.text()
      const mensagem = detalhe || `Evolution respondeu com status ${response.status}`
      await recordAppLog({
        nivel: "erro",
        origem: "evolution",
        mensagem: `Falha ao desconectar instância "${instancia}".`,
        detalhes: mensagem,
      })
      return { ok: false, erro: mensagem }
    }

    await recordAppLog({
      nivel: "info",
      origem: "evolution",
      mensagem: `Instância "${instancia}" desconectada.`,
    })
    return { ok: true }
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error)
    return { ok: false, erro: mensagem }
  }
}

/** Remove a instância por completo (DELETE /instance/delete/{nome}). */
export async function deleteEvolutionInstance(nome: string): Promise<{ ok: boolean; erro?: string }> {
  const { apiUrl, apiKey } = getEvolutionCredentials()
  if (!apiKey) return { ok: false, erro: "EVOLUTION_API_KEY não configurada no ambiente." }

  const instancia = nome.trim()
  if (!instancia) return { ok: false, erro: "Nome da instância ausente." }

  try {
    const response = await fetch(`${apiUrl}/instance/delete/${encodeURIComponent(instancia)}`, {
      method: "DELETE",
      headers: { apikey: apiKey },
      cache: "no-store",
    })

    if (!response.ok) {
      const detalhe = await response.text()
      const mensagem = detalhe || `Evolution respondeu com status ${response.status}`
      await recordAppLog({
        nivel: "erro",
        origem: "evolution",
        mensagem: `Falha ao remover instância "${instancia}".`,
        detalhes: mensagem,
      })
      return { ok: false, erro: mensagem }
    }

    // Remove também o registro no banco do painel para deixar de listá-la.
    try {
      await prisma.instance.deleteMany({ where: { nome: instancia } })
    } catch (error) {
      await recordAppLog({
        nivel: "aviso",
        origem: "evolution",
        mensagem: `Instância "${instancia}" removida da Evolution, mas o registro no banco do painel não pôde ser apagado.`,
        detalhes: error,
      })
    }

    await recordAppLog({
      nivel: "info",
      origem: "evolution",
      mensagem: `Instância "${instancia}" removida da Evolution API.`,
    })
    return { ok: true }
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error)
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
