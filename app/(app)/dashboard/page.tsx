import { Suspense } from "react"
import { CheckCircle2,Megaphone, MessageCircleReply, Radio, Send, Target, Users } from "lucide-react"

import { KpiCard } from "@/components/shared/kpi-card"
import { LinkButton } from "@/components/shared/link-button"
import { PageHeader } from "@/components/shared/page-header"
import { ActivityChart } from "@/components/features/dashboard/activity-chart"
import { RecentEvents } from "@/components/features/dashboard/recent-events"
import { TopCampaignsChart } from "@/components/features/dashboard/top-campaigns-chart"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { formatNumber, formatPercent } from "@/lib/format"
import { getFunil, getKpis, getPerformancePorCampanha, getSerieDiaria } from "@/services/analytics"
import { listEvents } from "@/services/events"

async function KpiGrid() {
  const kpis = await getKpis()
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      <KpiCard titulo="Leads ativos" valor={formatNumber(kpis.leadsAtivos)} variacao={kpis.variacao.leadsAtivos} icon={Users} />
      <KpiCard
        titulo="Campanhas ativas"
        valor={formatNumber(kpis.campanhasAtivas)}
        variacao={kpis.variacao.campanhasAtivas}
        icon={Megaphone}
      />
      <KpiCard
        titulo="Mensagens hoje"
        valor={formatNumber(kpis.mensagensHoje)}
        variacao={kpis.variacao.mensagensHoje}
        icon={Send}
      />
      <KpiCard
        titulo="Taxa de resposta"
        valor={formatPercent(kpis.taxaResposta)}
        variacao={kpis.variacao.taxaResposta}
        icon={MessageCircleReply}
      />
    </div>
  )
}

async function Graficos() {
  const [serie, campanhas] = await Promise.all([getSerieDiaria(30), getPerformancePorCampanha()])
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Atividade dos últimos 30 dias</CardTitle>
          <CardDescription>Mensagens enviadas e respostas recebidas por dia.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityChart dados={serie} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Campanhas mais eficientes</CardTitle>
          <CardDescription>Taxa de conversão em respostas de leads.</CardDescription>
        </CardHeader>
        <CardContent>
          <TopCampaignsChart dados={campanhas.filter((c) => c.leads > 0)} />
        </CardContent>
      </Card>
    </div>
  )
}

async function FunilCard() {
  const funil = await getFunil()
  const topo = funil[0]?.total || 1
  return (
    <Card>
      <CardHeader>
        <CardTitle>Funil de follow-up</CardTitle>
        <CardDescription>Da entrada do lead até a resposta.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {funil.map((etapa) => (
          <div key={etapa.etapa} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">{etapa.etapa}</span>
              <span className="font-mono font-medium">{formatNumber(etapa.total)}</span>
            </div>
            <Progress value={(etapa.total / topo) * 100} />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

async function EventosRecentes() {
  const eventos = await listEvents(8)
  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle>Últimos eventos</CardTitle>
        <CardDescription>Atividade automática mais recente da engine.</CardDescription>
        <CardAction>
          <LinkButton variant="outline" size="sm" href="/eventos">
            Ver todos
          </LinkButton>
        </CardAction>
      </CardHeader>
      <CardContent>
        <RecentEvents eventos={eventos} />
      </CardContent>
    </Card>
  )
}

function BlocoSkeleton({ altura = "h-72" }: { altura?: string }) {
  return <Skeleton className={`w-full rounded-xl ${altura}`} />
}

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        titulo="Dashboard"
        descricao="Visão geral da engine de follow-up: volume de mensagens e respostas de leads."
      >
        <LinkButton variant="outline" size="sm" href="/relatorios">
          Relatórios
        </LinkButton>
        <LinkButton size="sm" href="/campanhas/nova">
          Nova campanha
        </LinkButton>
      </PageHeader>

      <Suspense fallback={<BlocoSkeleton altura="h-28" />}>
        <KpiGrid />
      </Suspense>

      <Suspense fallback={<BlocoSkeleton />}>
        <Graficos />
      </Suspense>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Suspense fallback={<BlocoSkeleton />}>
          <EventosRecentes />
        </Suspense>
        <Suspense fallback={<BlocoSkeleton />}>
          <FunilCard />
        </Suspense>
      </div>
    </div>
  )
}
