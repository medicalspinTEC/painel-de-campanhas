import { DimensaoChart, DistribuicaoChart, FunilChart } from "@/components/features/reports/report-charts"
import { ReportsExportMenu } from "@/components/features/reports/reports-export-menu"
import { ReportsFilters } from "@/components/features/reports/reports-filters"
import { PageHeader } from "@/components/shared/page-header"
import { TemplateText } from "@/components/shared/template-text"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatNumber, formatPercent } from "@/lib/format"
import type { ReportExportData } from "@/lib/report-export"
import {
  getConversaoPorDimensao,
  getDistribuicaoPorDiaSemana,
  getDistribuicaoPorHorario,
  getFunil,
  getPerformancePorCampanha,
  getPerformancePorMensagem,
} from "@/services/analytics"

export const metadata = {
  title: "Relatórios | Painel de Campanhas WhatsApp",
}

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string }>
}) {
  const sp = await searchParams

  const de = sp.de ? new Date(`${sp.de}T00:00:00`) : undefined
  const ate = sp.ate ? new Date(`${sp.ate}T23:59:59.999`) : undefined
  const deValido = de && !Number.isNaN(de.getTime()) ? de : undefined
  const ateValido = ate && !Number.isNaN(ate.getTime()) ? ate : undefined
  const periodo = { de: deValido, ate: ateValido }
  const filtroAplicado = Boolean(deValido || ateValido)

  const [funil, diaSemana, horario, campanhas, mensagens, produto, marca, persona, regiao] = await Promise.all([
    getFunil(periodo),
    getDistribuicaoPorDiaSemana(periodo),
    getDistribuicaoPorHorario(periodo),
    getPerformancePorCampanha(periodo),
    getPerformancePorMensagem(periodo),
    getConversaoPorDimensao("produto", periodo),
    getConversaoPorDimensao("marca", periodo),
    getConversaoPorDimensao("persona", periodo),
    getConversaoPorDimensao("regiao", periodo),
  ])

  const exportData: ReportExportData = {
    periodo: { de: sp.de ?? null, ate: sp.ate ?? null },
    funil,
    diaSemana,
    horario,
    campanhas,
    mensagens,
    segmentos: { produto, marca, persona, regiao },
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Relatórios"
        descricao="Análise de campanhas, melhores horários e desempenho por mensagem."
      >
        <ReportsExportMenu data={exportData} />
      </PageHeader>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle>Período</CardTitle>
              <CardDescription>
                {filtroAplicado
                  ? "Relatórios e exportação recortados ao intervalo selecionado."
                  : "Sem filtro aplicado — relatórios e exportação cobrem todo o histórico."}
              </CardDescription>
            </div>
          </div>
          <div className="mt-4">
            <ReportsFilters valoresIniciais={{ de: sp.de ?? "", ate: sp.ate ?? "" }} />
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Funil de follow-up</CardTitle>
            <CardDescription>Do cadastro do lead até a resposta.</CardDescription>
          </CardHeader>
          <CardContent>
            <FunilChart dados={funil} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Melhor momento para enviar</CardTitle>
            <CardDescription>Taxa de resposta por dia da semana e faixa de horário.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="dia">
              <TabsList>
                <TabsTrigger value="dia">Dia da semana</TabsTrigger>
                <TabsTrigger value="horario">Horário</TabsTrigger>
              </TabsList>
              <TabsContent value="dia">
                <DistribuicaoChart dados={diaSemana} />
              </TabsContent>
              <TabsContent value="horario">
                <DistribuicaoChart dados={horario} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Análise por segmento</CardTitle>
          <CardDescription>Percentual de leads que respondem em cada dimensão.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="produto">
            <TabsList>
              <TabsTrigger value="produto">Produto</TabsTrigger>
              <TabsTrigger value="marca">Marca</TabsTrigger>
              <TabsTrigger value="persona">Persona</TabsTrigger>
              <TabsTrigger value="regiao">Região</TabsTrigger>
            </TabsList>
            <TabsContent value="produto">
              <DimensaoChart dados={produto} />
            </TabsContent>
            <TabsContent value="marca">
              <DimensaoChart dados={marca} />
            </TabsContent>
            <TabsContent value="persona">
              <DimensaoChart dados={persona} />
            </TabsContent>
            <TabsContent value="regiao">
              <DimensaoChart dados={regiao} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Desempenho por campanha</CardTitle>
            <CardDescription>Ordenado pela taxa de respostas.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campanha</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Enviadas</TableHead>
                  <TableHead className="text-right">Resposta</TableHead>                 
                </TableRow>
              </TableHeader>
              <TableBody>
                {campanhas.map((c) => (
                  <TableRow key={c.nome}>
                    <TableCell className="font-medium">{c.nome}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(c.leads)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(c.enviadas)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(c.taxaResposta)}</TableCell>                    
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mensagens com melhor retorno</CardTitle>
            <CardDescription>Top 8 mensagens por taxa de resposta.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {mensagens.slice(0, 8).map((m, index) => (
              <div key={`${m.campanha}-${m.dia}-${index}`} className="flex flex-col gap-1 border-b pb-3 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {m.campanha} · Dia {m.dia} · {m.horario}
                  </span>
                  <Badge variant="secondary" className="tabular-nums">
                    {formatPercent(m.taxaResposta)}
                  </Badge>
                </div>
                <p className="line-clamp-2 text-sm">
                  <TemplateText texto={m.texto} />
                </p>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatNumber(m.enviadas)} envios · {formatNumber(m.respostas)} respostas
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
