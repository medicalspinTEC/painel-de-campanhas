import { AppSidebar } from "@/components/layout/app-sidebar"
import { recordAppLog } from "@/services/app-logs"

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
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME

  try {
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
      profileImageUrl: process.env.EVOLUTION_PROFILE_IMAGE_URL?.trim() || null,
    }
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "evolution",
      mensagem: "Falha ao consultar status da instância Evolution API.",
      detalhes: error,
    })
    return {
      instanceName,
      instanceState: "unknown",
      profileImageUrl: null,
    }
  }
}

export async function AppSidebarData() {
  const status = await getEvolutionInstanceStatus()

  return (
    <AppSidebar
      instanceName={status.instanceName}
      instanceState={status.instanceState}
      profileImageUrl={status.profileImageUrl}
    />
  )
}
