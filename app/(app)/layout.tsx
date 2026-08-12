import type { ReactNode } from "react"

import { AppHeader } from "@/components/layout/app-header"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { DatabaseSetupNotice } from "@/components/layout/database-setup-notice"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { isDatabaseConfigured } from "@/lib/prisma"
import { recordAppLog } from "@/services/app-logs"
import { listCampaigns } from "@/services/campaigns"
import { listEvents } from "@/services/events"
import { listLeads } from "@/services/leads"

/*
 * O painel lê leads, campanhas e eventos direto do Postgres via Prisma. Como
 * não usamos `fetch`, o Next não detecta essas leituras e tentaria prerenderizar
 * as rotas no build — o que congelaria os dados no momento da compilação e, com
 * os workers de prerender em paralelo, esgotaria as conexões do banco. Estes
 * dados mudam a cada disparo, então as rotas precisam ser dinâmicas.
 */
export const dynamic = "force-dynamic"

/**
 * O Prisma inclui o trecho de código do bundler na mensagem em desenvolvimento,
 * o que produz um bloco enorme de nomes mangled do Turbopack. Aqui ficamos com
 * as linhas que descrevem o problema de fato, como "Can't reach database
 * server at ...", descartando stack e snippets.
 */
function resumirErro(error: unknown): string {
  const bruto = error instanceof Error ? error.message : String(error)

  const linhasUteis = bruto
    .split("\n")
    .map((linha) => linha.trim())
    .filter(
      (linha) =>
        linha.length > 0 &&
        !linha.includes("__TURBOPACK__") &&
        !linha.includes("$project$") &&
        !linha.startsWith("at ") &&
        !/^→?\s*\d+\s/.test(linha) && // linhas numeradas do snippet de código
        !/^\/?(vercel|home|app|users)\//i.test(linha) && // caminhos de arquivo
        !/^Invalid `/.test(linha), // cabeçalho "Invalid `prisma.x()` invocation"
    )

  const resumo = linhasUteis.join("\n").trim()
  return resumo.length > 0 ? resumo : bruto.split("\n")[0]
}

async function getEvolutionInstanceStatus() {
  const apiUrl = (process.env.EVOLUTION_API_URL ?? "https://evo-j0o08ok8sgwc4cog04w0owok.95.217.164.173.sslip.io").replace(/\/$/, "")
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

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Sem connection string nem faz sentido tentar consultar: mostramos o setup.
  if (!isDatabaseConfigured()) {
    return <DatabaseSetupNotice />
  }

  /*
   * O layout envolve todas as páginas do painel, então é aqui que a falha de
   * conexão aparece primeiro. Tratando o erro neste ponto, o usuário recebe
   * instruções em vez de uma tela de erro do Next em cada rota.
   */
  let leads: Awaited<ReturnType<typeof listLeads>>
  let campanhas: Awaited<ReturnType<typeof listCampaigns>>
  let notificacoes: Awaited<ReturnType<typeof listEvents>>
  const evolutionStatus = await getEvolutionInstanceStatus()

  try {
    ;[leads, campanhas, notificacoes] = await Promise.all([listLeads(), listCampaigns(), listEvents(30)])
  } catch (error) {
    console.error("[v0] Falha ao carregar dados do banco:", error)
    return <DatabaseSetupNotice erro={resumirErro(error)} />
  }

  return (
    <SidebarProvider>
      <AppSidebar
        instanceName={evolutionStatus.instanceName}
        instanceState={evolutionStatus.instanceState}
        profileImageUrl={evolutionStatus.profileImageUrl}
      />
      <SidebarInset className="min-w-0">
        <AppHeader
          leads={leads.slice(0, 40).map((l) => ({
            id: l.id,
            nome: l.nome,
            detalhe: l.produto,
            href: `/leads/${l.id}`,
          }))}
          campanhas={campanhas.map((c) => ({
            id: c.id,
            nome: c.nome,
            detalhe: `${c.totalLeads} leads`,
            href: `/campanhas/${c.id}`,
          }))}
          notificacoes={notificacoes}
        />
        <div className="min-w-0 flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
