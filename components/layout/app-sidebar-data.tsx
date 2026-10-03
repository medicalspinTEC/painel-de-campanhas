import { AppSidebar } from "@/components/layout/app-sidebar"
import { prisma } from "@/lib/prisma"
import { recordAppLog } from "@/services/app-logs"
import { getAppMarca, getAssistentePluginAtivo, getChatPluginAtivo, getKanbanPluginAtivo, getNocodePluginAtivo } from "@/services/settings"

/**
 * Consulta o status da instância do WhatsApp (Evolution API). Isolado do
 * restante do layout: uma instância lenta ou fora do ar não deve seguntar a
 * navegação inteira do painel — o Next transmite a sidebar completa assim que
 * este fetch (cacheado por 15s) responder.
 */
async function getEvolutionInstanceStatus() {
  const apiUrl = (process.env.EVOLUTION_API_URL ?? "https://evo-j0o08ok8sgwc4cog04w0owok.95.217.164.173.sslip.io").replace(
    /\/$/,
    "",
  )
  const apiKey = process.env.EVOLUTION_API_KEY
  const profileImageUrl = process.env.EVOLUTION_PROFILE_IMAGE_URL?.trim() || null

  try {
    const instanciaRegistrada = await prisma.instance.findFirst({
      orderBy: { criadoEm: "desc" },
      select: { nome: true },
    })
    const instanceName = instanciaRegistrada?.nome
    if (!instanceName) return { instanceName: undefined, instanceState: "unknown", profileImageUrl }

    const response = await fetch(`${apiUrl}/instance/connectionState/${instanceName}`, {
      headers: { apikey: apiKey ?? "" },
      next: { revalidate: 15 },
    })

    if (!response.ok) {
      throw new Error(`Evolution status request failed with ${response.status}`)
    }

    const payload = (await response.json()) as {
      instance?: { instanceName?: string; state?: string }
    }

    return {
      instanceName: payload.instance?.instanceName ?? instanceName,
      instanceState: payload.instance?.state ?? "unknown",
      profileImageUrl,
    }
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "evolution",
      mensagem: "Falha ao consultar status da instância Evolution API.",
      detalhes: error,
    })
    return {
      instanceName: undefined,
      instanceState: "unknown",
      profileImageUrl,
    }
  }
}

export async function AppSidebarData() {
  const [status, chatAtivo, kanbanAtivo, assistenteAtivo, marca, nocodeAtivo] = await Promise.all([
    getEvolutionInstanceStatus(),
    getChatPluginAtivo(),
    getKanbanPluginAtivo(),
    getAssistentePluginAtivo(),
    getAppMarca(),
    getNocodePluginAtivo(),
  ])

  return (
    <AppSidebar
      instanceName={status.instanceName}
      instanceState={status.instanceState}
      profileImageUrl={status.profileImageUrl}
      chatAtivo={chatAtivo}
      kanbanAtivo={kanbanAtivo}
      assistenteAtivo={assistenteAtivo}
      nocodeAtivo={nocodeAtivo}
      appNome={marca.nome}
      appLogo={marca.logo}
    />
  )
}
