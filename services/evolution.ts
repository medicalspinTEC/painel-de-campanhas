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

async function resolveRegisteredInstanceName(requestedName?: string | null): Promise<{ name: string } | { error: string }> {
  const nome = requestedName?.trim()

  try {
    const maisRecente = await prisma.instance.findFirst({
      orderBy: [{ atualizadoEm: "desc" }, { criadoEm: "desc" }],
      select: { nome: true },
    })
    if (!maisRecente) {
      return { error: "Nenhuma instância criada no app. Cadastre uma em Instâncias para enviar mensagens." }
    }

    if (nome) {
      const solicitada = await prisma.instance.findUnique({ where: { nome }, select: { nome: true } })
      if (!solicitada) return { error: `A instância "${nome}" não está cadastrada neste app.` }
    }

    return { name: maisRecente.nome }
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "evolution",
      mensagem: "Falha ao consultar as instâncias cadastradas no app.",
      detalhes: error,
    })
    return { error: "Não foi possível consultar as instâncias cadastradas no app." }
  }
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
      // Evolution lenta não pode travar a abertura das páginas.
      signal: AbortSignal.timeout(3000),
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

export interface InstanceOption {
  nome: string
  estado: EvolutionInstanceState
}

/**
 * Lista as instâncias cadastradas no app em ordem de uso recente.
 * A primeira opção aparece no topo dos seletores, mas todas as demais
 * continuam disponíveis para escolha.
 */
export async function listInstanceOptions(): Promise<InstanceOption[]> {
  let instancias: { nome: string }[] = []

  try {
    instancias = await prisma.instance.findMany({
      select: { nome: true },
      orderBy: [{ atualizadoEm: "desc" }, { criadoEm: "desc" }],
    })
  } catch {
    return []
  }

  if (instancias.length === 0) return []

  const doEvolution = await fetchEvolutionInstances()
  const estadoPorNome = new Map(doEvolution.map((i) => [i.nome, i.estado]))

  return instancias.map(({ nome }) => ({
    nome,
    estado: estadoPorNome.get(nome) ?? "desconectado",
  }))
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

async function shouldSendMessage(leadId: string, campanhaId: string, mensagemId: string | null): Promise<boolean> {
  // Campanhas `individual` não têm CampaignMessage (mensagemId nulo): a dedupe
  // de disparo único é feita pelo chamador via `LeadCampaign.enviadaIndividualEm`,
  // então aqui não há nada a checar.
  if (!mensagemId) return true

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

/**
 * Envia uma mensagem de voz (nota de voz do WhatsApp) via Evolution API.
 *
 * O áudio vai em base64 e `encoding: true` pede para a Evolution converter para
 * ogg/opus — é isso que faz o WhatsApp mostrar como mensagem de voz (com a onda de
 * áudio) mesmo quando o navegador gravou em webm ou mp4. Não grava nada no banco nem
 * no disco: quem chama decide o que guardar.
 */
export async function sendWhatsAppAudio(input: {
  telefone: string
  /** Conteúdo do áudio já em base64, sem o prefixo `data:`. */
  audioBase64: string
  /** Nome opcional para validar cadastro; o envio sempre usa a mais recente do app. */
  instanciaNome?: string | null
}): Promise<EvolutionSendResult> {
  const { apiUrl, apiKey } = getEvolutionCredentials()
  if (!apiKey) return { ok: false, erro: "EVOLUTION_API_KEY não configurada no ambiente." }

  const resolvida = await resolveRegisteredInstanceName(input.instanciaNome)
  if ("error" in resolvida) return { ok: false, erro: resolvida.error }
  const instanceName = resolvida.name

  const telefone = normalizePhoneForEvolution(input.telefone)
  if (!telefone) return { ok: false, erro: "Número de telefone inválido para envio." }

  try {
    const response = await fetch(`${apiUrl}/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: apiKey },
      body: JSON.stringify({ number: telefone, audio: input.audioBase64, encoding: true }),
    })

    if (!response.ok) {
      const detalhe = await response.text()
      let mensagemApi = detalhe
      try {
        const payload = JSON.parse(detalhe) as { response?: { message?: unknown }; message?: unknown }
        const mensagens = payload.response?.message ?? payload.message
        if (Array.isArray(mensagens)) {
          mensagemApi = mensagens.filter((item): item is string => typeof item === "string").join("; ") || detalhe
        } else if (typeof mensagens === "string") {
          mensagemApi = mensagens
        }
      } catch {
        // Respostas não JSON continuam disponíveis no log e na mensagem abaixo.
      }

      const mensagem = /connection closed/i.test(mensagemApi)
        ? `A conexão WhatsApp da instância "${instanceName}" foi encerrada pela Evolution. Reconecte a instância em Instâncias e tente novamente.`
        : mensagemApi || `Evolution respondeu com status ${response.status}`
      await recordAppLog({
        nivel: "erro",
        origem: "evolution",
        mensagem: `Evolution retornou HTTP ${response.status} ao enviar mensagem de voz.`,
        detalhes: detalhe || mensagem,
        contexto: {
          etapa: "Envio de mensagem de voz",
          instanciaNome: instanceName,
          telefone,
          statusHttp: String(response.status),
        },
      })
      return { ok: false, erro: mensagem }
    }

    return { ok: true }
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error)
    await recordAppLog({
      nivel: "erro",
      origem: "evolution",
      mensagem: "Exceção ao chamar a Evolution API para enviar mensagem de voz.",
      detalhes: error,
    })
    return { ok: false, erro: mensagem }
  }
}

/**
 * Envia uma imagem ou um arquivo (documento) via Evolution API (`POST /message/sendMedia/{instancia}`).
 * O conteúdo vai em base64 e NÃO é guardado em lugar nenhum: quem chama decide o que registrar.
 */
export async function sendWhatsAppMedia(input: {
  telefone: string
  /** Conteúdo já em base64, sem o prefixo `data:`. */
  base64: string
  mimetype: string
  fileName: string
  /** `image` aparece como foto no WhatsApp; `document` chega como arquivo para baixar. */
  mediatype: "image" | "document"
  caption?: string | null
  instanciaNome?: string | null
}): Promise<EvolutionSendResult> {
  const { apiUrl, apiKey } = getEvolutionCredentials()
  if (!apiKey) return { ok: false, erro: "EVOLUTION_API_KEY não configurada no ambiente." }

  const resolvida = await resolveRegisteredInstanceName(input.instanciaNome)
  if ("error" in resolvida) return { ok: false, erro: resolvida.error }
  const instanceName = resolvida.name

  const telefone = normalizePhoneForEvolution(input.telefone)
  if (!telefone) return { ok: false, erro: "Número de telefone inválido para envio." }

  try {
    const response = await fetch(`${apiUrl}/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: apiKey },
      body: JSON.stringify({
        number: telefone,
        mediatype: input.mediatype,
        mimetype: input.mimetype,
        caption: input.caption?.trim() || undefined,
        media: input.base64,
        fileName: input.fileName,
      }),
      signal: AbortSignal.timeout(60_000),
    })

    if (!response.ok) {
      const detalhe = await response.text()
      let mensagemApi = detalhe
      try {
        const payload = JSON.parse(detalhe) as { response?: { message?: unknown }; message?: unknown }
        const mensagens = payload.response?.message ?? payload.message
        if (Array.isArray(mensagens)) {
          mensagemApi = mensagens.filter((item): item is string => typeof item === "string").join("; ") || detalhe
        } else if (typeof mensagens === "string") {
          mensagemApi = mensagens
        }
      } catch {
        // Respostas não JSON continuam disponíveis no log e na mensagem abaixo.
      }

      const mensagem = /connection closed/i.test(mensagemApi)
        ? `A conexão WhatsApp da instância "${instanceName}" foi encerrada pela Evolution. Reconecte a instância em Instâncias e tente novamente.`
        : mensagemApi || `Evolution respondeu com status ${response.status}`
      await recordAppLog({
        nivel: "erro",
        origem: "evolution",
        mensagem: `Evolution retornou HTTP ${response.status} ao enviar ${input.mediatype === "image" ? "imagem" : "arquivo"}.`,
        detalhes: detalhe || mensagem,
        contexto: {
          etapa: "Envio de imagem/arquivo",
          instanciaNome: instanceName,
          telefone,
          statusHttp: String(response.status),
        },
      })
      return { ok: false, erro: mensagem }
    }

    return { ok: true }
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error)
    await recordAppLog({
      nivel: "erro",
      origem: "evolution",
      mensagem: "Exceção ao chamar a Evolution API para enviar imagem/arquivo.",
      detalhes: error,
    })
    return { ok: false, erro: mensagem }
  }
}

/**
 * Envia um texto livre via WhatsApp (Evolution API), sem qualquer lógica de
 * campanha, dedupe ou timeline — apenas a chamada HTTP. Usado pelo envio
 * manual/individual de mensagem a um lead (ver `services/leads.ts`), que
 * registra o evento na timeline por conta própria (sem atribuir a campanha
 * alguma, mesmo que o lead esteja vinculado a uma no momento do envio).
 */
export async function sendWhatsAppText(input: {
  telefone: string
  texto: string
  /** Nome opcional para validar cadastro; o envio sempre usa a mais recente do app. */
  instanciaNome?: string | null
}): Promise<EvolutionSendResult> {
  const { apiUrl, apiKey } = getEvolutionCredentials()
  if (!apiKey) return { ok: false, erro: "EVOLUTION_API_KEY não configurada no ambiente." }

  const resolvida = await resolveRegisteredInstanceName(input.instanciaNome)
  if ("error" in resolvida) return { ok: false, erro: resolvida.error }
  const instanceName = resolvida.name

  const telefone = normalizePhoneForEvolution(input.telefone)
  if (!telefone) {
    return { ok: false, erro: "Número de telefone inválido para envio." }
  }

  try {
    const response = await fetch(`${apiUrl}/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: apiKey },
      body: JSON.stringify({ number: telefone, text: input.texto }),
    })

    if (!response.ok) {
      const detalhe = await response.text()
      let mensagemApi = detalhe
      try {
        const payload = JSON.parse(detalhe) as {
          response?: { message?: unknown }
          message?: unknown
        }
        const mensagens = payload.response?.message ?? payload.message
        if (Array.isArray(mensagens)) {
          mensagemApi = mensagens.filter((item): item is string => typeof item === "string").join("; ") || detalhe
        } else if (typeof mensagens === "string") {
          mensagemApi = mensagens
        }
      } catch {
        // Respostas não JSON continuam disponíveis no log e na mensagem abaixo.
      }

      const mensagem = /connection closed/i.test(mensagemApi)
        ? `A conexão WhatsApp da instância "${instanceName}" foi encerrada pela Evolution. Reconecte a instância em Instâncias e tente novamente.`
        : mensagemApi || `Evolution respondeu com status ${response.status}`
      await recordAppLog({
        nivel: "erro",
        origem: "evolution",
        mensagem: `Evolution retornou HTTP ${response.status} ao enviar mensagem individual.`,
        detalhes: detalhe || mensagem,
        contexto: {
          etapa: "Envio de mensagem individual",
          instanciaNome: instanceName,
          telefone,
          statusHttp: String(response.status),
        },
      })
      return { ok: false, erro: mensagem }
    }

    return { ok: true }
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error)
    await recordAppLog({
      nivel: "erro",
      origem: "evolution",
      mensagem: "Exceção ao chamar a Evolution API para enviar mensagem individual.",
      detalhes: error,
    })
    return { ok: false, erro: mensagem }
  }
}

export async function sendCampaignMessageToLead(input: {
  leadId: string
  campanhaId: string
  /** Nulo para campanhas `individual` (não há CampaignMessage associada). */
  mensagemId: string | null
  texto: string
  telefone: string
  /**
  * Nome opcional para validar cadastro; o envio sempre usa a instância mais
  * recente criada no app.
   */
  instanciaNome?: string | null
  /** Descrição registrada na timeline em caso de sucesso. */
  descricaoSucesso?: string
  /** Descrição registrada na timeline em caso de falha. */
  descricaoFalha?: string
}): Promise<EvolutionSendResult> {
  const descricaoSucesso = input.descricaoSucesso ?? "Mensagem inicial da campanha enviada via Evolution."
  const descricaoFalha = input.descricaoFalha ?? "Falha ao enviar mensagem da campanha via Evolution."
  const apiUrl = (process.env.EVOLUTION_API_URL ?? "https://evo-j0o08ok8sgwc4cog04w0owok.95.217.164.173.sslip.io").replace(/\/$/, "")
  const apiKey = process.env.EVOLUTION_API_KEY?.trim()
  if (!apiKey) {
    const mensagem = "EVOLUTION_API_KEY não configurada no ambiente."
    await recordAppLog({
      nivel: "critico",
      origem: "evolution",
      mensagem,
      detalhes: `leadId=${input.leadId} campanhaId=${input.campanhaId}`,
      contexto: {
        etapa: "Validação de credenciais (sendCampaignMessageToLead)",
        leadId: input.leadId,
        campanhaId: input.campanhaId,
        mensagemId: input.mensagemId ?? undefined,
        instanciaNome: input.instanciaNome ?? undefined,
      },
    })
    return { ok: false, erro: mensagem }
  }

  const resolvida = await resolveRegisteredInstanceName(input.instanciaNome)
  if ("error" in resolvida) {
    await recordAppLog({
      nivel: "critico",
      origem: "evolution",
      mensagem: resolvida.error,
      detalhes: `leadId=${input.leadId} campanhaId=${input.campanhaId}`,
      contexto: {
        etapa: "Validação da instância (sendCampaignMessageToLead)",
        leadId: input.leadId,
        campanhaId: input.campanhaId,
        mensagemId: input.mensagemId ?? undefined,
        instanciaNome: input.instanciaNome ?? undefined,
      },
    })
    return { ok: false, erro: resolvida.error }
  }
  const instanceName = resolvida.name

  const telefone = normalizePhoneForEvolution(input.telefone)
  if (!telefone) {
    const mensagem = "Número de telefone inválido para envio."
    await recordAppLog({
      nivel: "aviso",
      origem: "evolution",
      mensagem,
      detalhes: `telefone original="${input.telefone}" leadId=${input.leadId}`,
      contexto: {
        etapa: "Validação de telefone (sendCampaignMessageToLead)",
        leadId: input.leadId,
        campanhaId: input.campanhaId,
        mensagemId: input.mensagemId ?? undefined,
        telefone: input.telefone,
      },
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
          texto,
          descricao: descricaoFalha,
          detalhes: mensagem,
        }),
        recordAppLog({
          nivel: "erro",
          origem: "evolution",
          mensagem: `Evolution retornou HTTP ${response.status}`,
          detalhes: mensagem,
          contexto: {
            etapa: "Resposta da Evolution API (sendCampaignMessageToLead)",
            leadId: input.leadId,
            campanhaId: input.campanhaId,
            mensagemId: input.mensagemId ?? undefined,
            instanciaNome: instanceName,
            telefone,
            statusHttp: String(response.status),
            endpoint: `${apiUrl}/message/sendText/${instanceName}`,
          },
        }),
      ])

      return { ok: false, erro: mensagem }
    }

    await recordMessageEvent({
      kind: "enviada",
      leadId: input.leadId,
      campanhaId: input.campanhaId,
      mensagemId: input.mensagemId,
      texto,
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
        texto,
        descricao: descricaoFalha,
        detalhes: mensagem,
      }),
      recordAppLog({
        nivel: "erro",
        origem: "evolution",
        mensagem: "Exceção ao chamar a Evolution API.",
        detalhes: error,
        contexto: {
          etapa: "Chamada HTTP à Evolution API (sendCampaignMessageToLead)",
          leadId: input.leadId,
          campanhaId: input.campanhaId,
          mensagemId: input.mensagemId ?? undefined,
          instanciaNome: instanceName,
          telefone,
          endpoint: `${apiUrl}/message/sendText/${instanceName}`,
        },
      }),
    ])

    return { ok: false, erro: mensagem }
  }
}

// ---------------------------------------------------------------------------
// Foto de perfil do lead
// ---------------------------------------------------------------------------

/** "foto" achou; "sem_foto" existe no WhatsApp mas não tem foto visível e "nao_existe" não está no WhatsApp
 *  (nos dois casos não consulta de novo até o lead ser editado); "erro" falha temporária (tenta de novo). */
export type LeadFotoStatus = "foto" | "sem_foto" | "nao_existe" | "erro"
export interface LeadFotoResultado {
  status: LeadFotoStatus
  url?: string
}

const FOTO_TTL_ENCONTRADA_MS = 30 * 60 * 1000
const FOTO_TTL_ERRO_MS = 5 * 1000
const INSTANCIAS_TTL_MS = 60 * 1000
const FOTO_CONCORRENCIA = 4

const fotoCache = new Map<string, { resultado: LeadFotoResultado; expiraEm: number }>()
const fotoEmAndamento = new Map<string, Promise<LeadFotoResultado>>()
/** leadId -> atualizadoEm (ms) do lead quando se descobriu que não há foto (ou que o número não está no WhatsApp). */
const naoExisteNoWhatsapp = new Map<string, number>()
let instanciasCache: { nomes: string[]; expiraEm: number } | null = null

/** Limita quantas buscas de foto falam com a Evolution ao mesmo tempo. */
let fotoAtivas = 0
const fotoFila: Array<() => void> = []
async function comLimiteDeFotos<T>(tarefa: () => Promise<T>): Promise<T> {
  if (fotoAtivas >= FOTO_CONCORRENCIA) {
    await new Promise<void>((resolve) => fotoFila.push(resolve))
  }
  fotoAtivas++
  try {
    return await tarefa()
  } finally {
    fotoAtivas--
    fotoFila.shift()?.()
  }
}

/** Instâncias cadastradas no app (as mais usadas primeiro). Não depende do estado de conexão. */
async function listarInstanciasDoApp(): Promise<string[]> {
  const agora = Date.now()
  if (instanciasCache && instanciasCache.expiraEm > agora) return instanciasCache.nomes
  const registradas = await prisma.instance.findMany({
    select: { nome: true },
    orderBy: [{ atualizadoEm: "desc" }, { criadoEm: "desc" }],
  })
  const nomes = registradas.map((i) => i.nome)
  instanciasCache = { nomes, expiraEm: agora + (nomes.length ? INSTANCIAS_TTL_MS : 5000) }
  return nomes
}

/**
 * Números a tentar. No Brasil o WhatsApp pode registrar o contato com ou sem
 * o 9º dígito, então tenta também a outra forma.
 */
function variantesDoNumero(telefone: string): string[] {
  const numero = normalizePhoneForEvolution(telefone).replace(/^\+/, "")
  if (!numero) return []
  const variantes = [numero]
  if (numero.startsWith("55") && numero.length === 13 && numero[4] === "9") {
    variantes.push(numero.slice(0, 4) + numero.slice(5))
  } else if (numero.startsWith("55") && numero.length === 12) {
    variantes.push(numero.slice(0, 4) + "9" + numero.slice(4))
  }
  return variantes
}

async function chamarEvolution(caminho: string, instancia: string, corpo: unknown): Promise<{ status: number; json: unknown } | null> {
  const { apiUrl, apiKey } = getEvolutionCredentials()
  if (!apiKey) return null
  try {
    const response = await fetch(`${apiUrl}${caminho}/${encodeURIComponent(instancia)}`, {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    })
    const texto = await response.text().catch(() => "")
    let json: unknown = null
    try {
      json = JSON.parse(texto)
    } catch {}
    if (!response.ok) {
      await recordAppLog({
        nivel: "aviso",
        origem: "evolution",
        mensagem: `Foto de perfil: ${caminho} na instância "${instancia}" respondeu ${response.status}.`,
        detalhes: texto.slice(0, 300),
      })
    }
    return { status: response.status, json }
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "evolution",
      mensagem: `Falha em ${caminho} na instância "${instancia}".`,
      detalhes: error,
    })
    return null
  }
}

/** POST /chat/fetchProfilePictureUrl/{instancia}. */
async function buscarFotoNaInstancia(instancia: string, numero: string): Promise<{ url: string | null; erro: boolean }> {
  const r = await chamarEvolution("/chat/fetchProfilePictureUrl", instancia, { number: numero })
  if (!r) return { url: null, erro: true }
  const url = (r.json as { profilePictureUrl?: unknown } | null)?.profilePictureUrl
  return {
    url: typeof url === "string" && /^https?:\/\//i.test(url) ? url : null,
    erro: r.status >= 500,
  }
}

/** POST /chat/whatsappNumbers/{instancia}: true/false se algum número existe no WhatsApp; null se não deu para saber. */
async function numeroExisteNaInstancia(instancia: string, numeros: string[]): Promise<boolean | null> {
  const r = await chamarEvolution("/chat/whatsappNumbers", instancia, { numbers: numeros })
  if (!r || r.status >= 400 || !Array.isArray(r.json)) return null
  return (r.json as Array<{ exists?: boolean }>).some((item) => item?.exists === true)
}

async function resolverFoto(lead: { id: string; telefone: string; atualizadoEm: Date }): Promise<LeadFotoResultado> {
  const variantes = variantesDoNumero(lead.telefone)
  if (variantes.length === 0) return { status: "nao_existe" }

  const instancias = await listarInstanciasDoApp()
  if (instancias.length === 0 || !getEvolutionCredentials().apiKey) return { status: "erro" }

  // 1) Tenta a foto em todas as instâncias (a primeira com foto vale).
  let houveErro = false
  for (const numero of variantes) {
    const resultados = await Promise.all(instancias.map((nome) => buscarFotoNaInstancia(nome, numero)))
    houveErro = houveErro || resultados.some((r) => r.erro)
    const achada = resultados.find((r) => r.url)?.url
    if (achada) return { status: "foto", url: achada }
  }

  // 2) Sem foto: descobre se o número sequer existe no WhatsApp.
  const existencia = await Promise.all(instancias.map((nome) => numeroExisteNaInstancia(nome, variantes)))
  if (existencia.some((e) => e === true)) {
    naoExisteNoWhatsapp.set(lead.id, lead.atualizadoEm.getTime())
    return { status: "sem_foto" }
  }
  if (!houveErro && existencia.every((e) => e === false)) {
    naoExisteNoWhatsapp.set(lead.id, lead.atualizadoEm.getTime())
    return { status: "nao_existe" }
  }
  return { status: "erro" }
}

/**
 * Foto de perfil do lead, buscada em TODAS as instâncias cadastradas.
 * - Sem foto, ou número fora do WhatsApp: não consulta mais até o lead ser editado (muda `atualizadoEm`).
 */
export async function getLeadProfilePicture(lead: { id: string; telefone: string; atualizadoEm: Date }): Promise<LeadFotoResultado> {
  if (naoExisteNoWhatsapp.get(lead.id) === lead.atualizadoEm.getTime()) return { status: "sem_foto" }
  naoExisteNoWhatsapp.delete(lead.id)

  const chave = `${lead.id}:${lead.telefone}`
  const emCache = fotoCache.get(chave)
  if (emCache && emCache.expiraEm > Date.now()) return emCache.resultado

  const andamento = fotoEmAndamento.get(chave)
  if (andamento) return andamento

  const busca = comLimiteDeFotos(async () => {
    const resultado = await resolverFoto(lead)
    if (resultado.status === "foto" || resultado.status === "erro") {
      const ttl = resultado.status === "foto" ? FOTO_TTL_ENCONTRADA_MS : FOTO_TTL_ERRO_MS
      fotoCache.set(chave, { resultado, expiraEm: Date.now() + ttl })
    }
    return resultado
  }).finally(() => fotoEmAndamento.delete(chave))

  fotoEmAndamento.set(chave, busca)
  return busca
}

// ---------------------------------------------------------------------------
// Webhook da instância
// ---------------------------------------------------------------------------

/**
 * Liga o webhook de uma instância na Evolution, só com o evento MESSAGES_UPSERT
 * (mensagens recebidas). Tenta o formato da v2 (`{ webhook: {...} }`) e, se a
 * Evolution rejeitar, o da v1 (campos soltos).
 */
export async function configurarWebhookEvolution(
  instancia: string,
  url: string,
): Promise<{ ok: boolean; erro?: string }> {
  const { apiUrl, apiKey } = getEvolutionCredentials()
  if (!apiKey) return { ok: false, erro: "EVOLUTION_API_KEY não configurada no ambiente." }

  const eventos = ["MESSAGES_UPSERT"]
  const formatos: Array<Record<string, unknown>> = [
    { webhook: { enabled: true, url, byEvents: false, base64: false, events: eventos } },
    { enabled: true, url, webhook_by_events: false, webhook_base64: false, events: eventos },
  ]

  let ultimoErro = ""
  for (const corpo of formatos) {
    try {
      const response = await fetch(`${apiUrl}/webhook/set/${encodeURIComponent(instancia)}`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: apiKey },
        body: JSON.stringify(corpo),
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      })
      if (response.ok) return { ok: true }

      const texto = (await response.text().catch(() => "")).slice(0, 300)
      ultimoErro = `Evolution respondeu ${response.status}${texto ? `: ${texto}` : ""}`
      // 5xx não é questão de formato: não adianta tentar de novo com outro.
      if (response.status >= 500) break
    } catch (error) {
      ultimoErro = error instanceof Error ? error.message : String(error)
      break
    }
  }

  await recordAppLog({
    nivel: "erro",
    origem: "evolution",
    mensagem: `Falha ao configurar o webhook da instância "${instancia}".`,
    detalhes: ultimoErro,
  })
  return { ok: false, erro: ultimoErro }
}

/**
 * Baixa a mídia (áudio, imagem, documento…) de uma mensagem recebida (`POST /chat/getBase64FromMediaMessage/{instancia}`).
 *
 * O webhook do app não pede o base64 junto do evento (`base64: false`, para não inflar todo
 * payload de texto), então o arquivo da mensagem é buscado aqui, sob demanda.
 * Tenta primeiro só pelo id da mensagem (a Evolution a busca no próprio banco) e, se ela não
 * a achar, reenvia a mensagem inteira que veio no webhook. Repete algumas vezes porque o
 * webhook pode chegar antes de a Evolution terminar de gravar a mensagem.
 */
export async function baixarMidiaDaEvolution(input: {
  /** Instância que recebeu a mensagem (vem no webhook). Sem ela, usa a mais recente do app. */
  instancia?: string | null
  /** `data.key` do webhook. */
  key: unknown
  /** `data.message` do webhook. */
  message: unknown
}): Promise<{ ok: true; dados: Buffer; mimetype: string | null; nome: string | null } | { ok: false; erro: string }> {
  const { apiUrl, apiKey } = getEvolutionCredentials()
  if (!apiKey) return { ok: false, erro: "EVOLUTION_API_KEY não configurada no ambiente." }

  const instancia = input.instancia?.trim() || (await listarInstanciasDoApp())[0]
  if (!instancia) return { ok: false, erro: "Nenhuma instância para baixar a mídia." }

  const idDaMensagem = (input.key as { id?: unknown } | null)?.id
  const corpos: Array<Record<string, unknown>> = []
  if (typeof idDaMensagem === "string" && idDaMensagem) {
    corpos.push({ message: { key: { id: idDaMensagem } }, convertToMp4: false })
  }
  corpos.push({ message: { key: input.key, message: input.message }, convertToMp4: false })

  let ultimoErro = "Evolution não devolveu a mídia."
  for (let rodada = 0; rodada < 3; rodada += 1) {
    if (rodada > 0) await new Promise((resolve) => setTimeout(resolve, 2000))
    for (const corpo of corpos) {
      try {
        const response = await fetch(`${apiUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(instancia)}`, {
          method: "POST",
          headers: { "content-type": "application/json", apikey: apiKey },
          body: JSON.stringify(corpo),
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        })
        const texto = await response.text().catch(() => "")
        if (!response.ok) {
          ultimoErro = `Evolution respondeu ${response.status}${texto ? `: ${texto.slice(0, 200)}` : ""}`
          continue
        }
        let json: { base64?: unknown; mimetype?: unknown; fileName?: unknown } | null = null
        try {
          json = JSON.parse(texto)
        } catch {
          // resposta não JSON: cai no erro abaixo
        }
        const base64 = typeof json?.base64 === "string" ? json.base64.replace(/^data:[^;]*;base64,/, "") : ""
        if (!base64) {
          ultimoErro = "A Evolution respondeu sem o conteúdo (base64) da mídia."
          continue
        }
        const dados = Buffer.from(base64, "base64")
        if (dados.length === 0) {
          ultimoErro = "A Evolution devolveu um arquivo vazio."
          continue
        }
        return {
          ok: true,
          dados,
          mimetype: typeof json?.mimetype === "string" ? json.mimetype : null,
          nome: typeof json?.fileName === "string" ? json.fileName : null,
        }
      } catch (error) {
        ultimoErro = error instanceof Error ? error.message : String(error)
      }
    }
  }

  await recordAppLog({
    nivel: "aviso",
    origem: "evolution",
    mensagem: `Não foi possível baixar a mídia recebida na instância "${instancia}".`,
    detalhes: ultimoErro,
  })
  return { ok: false, erro: ultimoErro }
}
