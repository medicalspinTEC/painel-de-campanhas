import { Suspense, type ReactNode } from "react"

import { AppHeaderData } from "@/components/layout/app-header-data"
import { AppHeaderSkeleton } from "@/components/layout/app-header-skeleton"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { AppSidebarData } from "@/components/layout/app-sidebar-data"
import { DatabaseSetupNotice } from "@/components/layout/database-setup-notice"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { checkDatabaseConnection, isDatabaseConfigured } from "@/lib/prisma"

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

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Sem connection string nem faz sentido tentar consultar: mostramos o setup.
  if (!isDatabaseConfigured()) {
    return <DatabaseSetupNotice />
  }

  /*
   * O layout envolve todas as páginas do painel, então é aqui que a falha de
   * conexão aparece primeiro. Antes, essa checagem carregava leads, campanhas
   * E eventos por completo (com agregações) a cada navegação, só para
   * confirmar que o banco respondia — um `SELECT 1` faz a mesma verificação
   * sem o custo. Os dados de fato (busca do cabeçalho, status da instância)
   * são buscados por `AppHeaderData`/`AppSidebarData` abaixo, cada um dentro
   * do seu próprio `<Suspense>`, para não travar a troca de página.
   */
  try {
    await checkDatabaseConnection()
  } catch (error) {
    console.error("[v0] Falha ao conectar ao banco:", error)
    return <DatabaseSetupNotice erro={resumirErro(error)} />
  }

  return (
    <SidebarProvider>
      <Suspense fallback={<AppSidebar instanceState="unknown" />}>
        <AppSidebarData />
      </Suspense>
      <SidebarInset className="min-w-0">
        <Suspense fallback={<AppHeaderSkeleton />}>
          <AppHeaderData />
        </Suspense>
        <div className="min-w-0 flex-1 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
