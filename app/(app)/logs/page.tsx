import Link from "next/link"
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Info,
  ServerCrash,
  ShieldAlert,
  TriangleAlert,
  Zap,
} from "lucide-react"

import { KpiCard } from "@/components/shared/kpi-card"
import { PageHeader } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"
import { listEvents, listFailures } from "@/services/events"
import { listAppLogOrigens, listAppLogs, getAppLogStats, type AppLogNivel } from "@/services/app-logs"
import { LogTechnicalDetails } from "@/components/features/logs/log-technical-details"
import { LogsExportButton } from "@/components/features/logs/logs-export-button"
import { LogsFilters } from "@/components/features/logs/logs-filters"

export const metadata = {
  title: "Logs | Painel de Campanhas WhatsApp",
}

const NIVEIS_VALIDOS: AppLogNivel[] = ["info", "aviso", "erro", "critico"]
const NIVEL_LABEL: Record<AppLogNivel, string> = {
  info: "Info",
  aviso: "Aviso",
  erro: "Erro",
  critico: "Crítico",
}

// ---------------------------------------------------------------------------
// Helpers visuais para nível de log
// ---------------------------------------------------------------------------

const NIVEL_CONFIG: Record<
  AppLogNivel,
  { label: string; className: string }
> = {
  info: {
    label: "Info",
    className: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  },
  aviso: {
    label: "Aviso",
    className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
  },
  erro: {
    label: "Erro",
    className: "bg-destructive/10 text-destructive border-destructive/20",
  },
  critico: {
    label: "Crítico",
    className: "bg-red-700/10 text-red-600 border-red-700/20",
  },
}

function NivelBadge({ nivel }: { nivel: AppLogNivel }) {
  const { label, className } = NIVEL_CONFIG[nivel] ?? NIVEL_CONFIG.erro
  return (
    <Badge variant="outline" className={cn("font-medium", className)}>
      {label}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Rótulos amigáveis para a origem do erro (não altera o dado gravado, só a
// forma como é exibido para quem não é programador).
// ---------------------------------------------------------------------------

const ORIGEM_LABELS: Record<string, string> = {
  leads: "Leads",
  campaigns: "Campanhas",
  "campaign-engine": "Motor de campanhas",
  evolution: "Envio de WhatsApp (Evolution API)",
  whatsapp: "WhatsApp",
  webhooks: "Webhooks",
  "inbound-webhook": "Webhook recebido",
  settings: "Configurações",
  produtos: "Produtos",
  marcas: "Marcas",
  personas: "Personas",
  regioes: "Regiões",
}

function formatOrigem(origem: string): string {
  return ORIGEM_LABELS[origem] ?? origem
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ nivel?: string; origem?: string; de?: string; ate?: string }>
}) {
  const sp = await searchParams

  const nivel = sp.nivel && NIVEIS_VALIDOS.includes(sp.nivel as AppLogNivel) ? (sp.nivel as AppLogNivel) : undefined
  const origem = sp.origem?.trim() || undefined
  const de = sp.de ? new Date(`${sp.de}T00:00:00`) : undefined
  const ate = sp.ate ? new Date(`${sp.ate}T23:59:59.999`) : undefined
  const deValido = de && !Number.isNaN(de.getTime()) ? de : undefined
  const ateValido = ate && !Number.isNaN(ate.getTime()) ? ate : undefined

  const [falhas, todos, appLogs, origensDisponiveis, statsAppLogs] = await Promise.all([
    listFailures(),
    listEvents(),
    listAppLogs({ nivel, origem, de: deValido, ate: ateValido }),
    listAppLogOrigens(),
    getAppLogStats(),
  ])

  const filtroAplicado = Boolean(nivel || origem || deValido || ateValido)
  const resumoFiltros = filtroAplicado
    ? [
        nivel && `Nível: ${NIVEL_LABEL[nivel]}`,
        origem && `Origem: ${formatOrigem(origem)}`,
        deValido && `De: ${sp.de}`,
        ateValido && `Até: ${sp.ate}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Nenhum filtro aplicado"

  // KPIs de entrega
  const tentativas = todos.filter(
    (e) => e.tipo === "mensagem_enviada" || e.tipo === "falha",
  ).length
  const taxaFalha = tentativas > 0 ? (falhas.length / tentativas) * 100 : 0

  // KPIs de sistema (sempre o total geral — não muda com os filtros da tabela).
  const errosSistema = statsAppLogs.erros
  const avisosSistema = statsAppLogs.avisos

  // Agrupamento por motivo (entrega)
  const porMotivo = new Map<string, number>()
  for (const falha of falhas) {
    const motivo = falha.detalhes ?? "Motivo não informado"
    porMotivo.set(motivo, (porMotivo.get(motivo) ?? 0) + 1)
  }
  const motivos = Array.from(porMotivo.entries()).sort((a, b) => b[1] - a[1])

  // Agrupamento por origem (sistema)
  const porOrigem = new Map<string, number>()
  for (const log of appLogs) {
    if (log.nivel === "erro" || log.nivel === "critico") {
      porOrigem.set(log.origem, (porOrigem.get(log.origem) ?? 0) + 1)
    }
  }
  const origens = Array.from(porOrigem.entries()).sort((a, b) => b[1] - a[1])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Logs"
        descricao="Diagnóstico de falhas de entrega no gateway e erros internos do sistema."
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          titulo="Tentativas de envio"
          valor={formatNumber(tentativas)}
          icon={CheckCircle2}
        />
        <KpiCard
          titulo="Falhas de entrega"
          valor={formatNumber(falhas.length)}
          icon={AlertTriangle}
        />
        <KpiCard
          titulo="Taxa de falha"
          valor={formatPercent(taxaFalha)}
          icon={ShieldAlert}
        />
        <KpiCard
          titulo="Erros do sistema"
          valor={formatNumber(errosSistema)}
          icon={Zap}
        />
      </div>

      {/* Abas */}
      <Tabs defaultValue="sistema">        
        {/* ─── Erros do sistema ──────────────────────────────────── */}
        <TabsContent value="sistema" className="mt-4">
          <div>           
            <Card className="xl:col-span-2">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <CardTitle>Histórico de erros do sistema</CardTitle>
                    <CardDescription>
                      {appLogs.length} {appLogs.length === 1 ? "entrada" : "entradas"}
                      {filtroAplicado ? ` filtrada(s) (${resumoFiltros})` : ""}, da mais recente para a mais antiga.
                    </CardDescription>
                  </div>
                  <LogsExportButton logs={appLogs} filtrosResumo={resumoFiltros} />
                </div>
                <div className="mt-4">
                  <LogsFilters
                    origens={origensDisponiveis}
                    valoresIniciais={{
                      nivel: nivel ?? "todos",
                      origem: origem ?? "todos",
                      de: sp.de ?? "",
                      ate: sp.ate ?? "",
                    }}
                  />
                </div>
              </CardHeader>
              <CardContent>
                {appLogs.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {filtroAplicado
                      ? "Nenhum erro encontrado com os filtros atuais."
                      : "Nenhum erro de sistema registrado. Tudo operando normalmente."}
                  </p>
                ) : (
                  <div className="max-h-[32rem] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>Nível</TableHead>
                          <TableHead>Origem</TableHead>
                          <TableHead>Mensagem</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {appLogs.map((log) => (
                          <TableRow key={log.id}>
                            <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                              {formatDateTime(log.data)}
                            </TableCell>
                            <TableCell>
                              <NivelBadge nivel={log.nivel} />
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatOrigem(log.origem)}
                            </TableCell>
                            <TableCell>
                              <LogTechnicalDetails
                                nivel={log.nivel}
                                origem={log.origem}
                                mensagem={log.mensagem}
                                detalhes={log.detalhes}
                                data={log.data}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}