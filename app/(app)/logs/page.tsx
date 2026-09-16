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
import { listAppLogs, type AppLogNivel } from "@/services/app-logs"
import { LogTechnicalDetails } from "@/components/features/logs/log-technical-details"

export const metadata = {
  title: "Logs | Painel de Campanhas WhatsApp",
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

export default async function LogsPage() {
  const [falhas, todos, appLogs] = await Promise.all([
    listFailures(),
    listEvents(),
    listAppLogs(),
  ])

  // KPIs de entrega
  const tentativas = todos.filter(
    (e) => e.tipo === "mensagem_enviada" || e.tipo === "falha",
  ).length
  const taxaFalha = tentativas > 0 ? (falhas.length / tentativas) * 100 : 0

  // KPIs de sistema
  const errosSistema = appLogs.filter(
    (l) => l.nivel === "erro" || l.nivel === "critico",
  ).length
  const avisosSistema = appLogs.filter((l) => l.nivel === "aviso").length

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
      <Tabs defaultValue="entrega">        
        {/* ─── Falhas de entrega ─────────────────────────────────── */}
        <TabsContent value="entrega" className="mt-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">

            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Histórico de falhas</CardTitle>
                <CardDescription>
                  {falhas.length} ocorrências, da mais recente para a mais antiga.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {falhas.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Nenhuma falha nas últimas semanas. Entrega saudável.
                  </p>
                ) : (
                  <div className="max-h-[32rem] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>Lead</TableHead>
                          <TableHead>Campanha</TableHead>
                          <TableHead>Motivo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {falhas.map((falha) => (
                          <TableRow key={falha.id}>
                            <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                              {formatDateTime(falha.data)}
                            </TableCell>
                            <TableCell>
                              <Link
                                href={`/leads/${falha.leadId}`}
                                className="font-medium hover:underline"
                              >
                                {falha.leadNome}
                              </Link>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {falha.campanhaNome ?? "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="destructive">
                                {falha.detalhes ?? "Não informado"}
                              </Badge>
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

        {/* ─── Erros do sistema ──────────────────────────────────── */}
        <TabsContent value="sistema" className="mt-4">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Histórico de erros do sistema</CardTitle>
                <CardDescription>
                  {appLogs.length}{" "}
                  {appLogs.length === 1 ? "entrada" : "entradas"}, da mais
                  recente para a mais antiga.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {appLogs.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum erro de sistema registrado. Tudo operando normalmente.
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
        </TabsContent>
      </Tabs>
    </div>
  )
}