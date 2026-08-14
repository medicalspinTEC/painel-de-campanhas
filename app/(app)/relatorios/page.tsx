import { DimensaoChart, DistribuicaoChart, FunilChart } from "@/components/features/reports/report-charts"
import { PageHeader } from "@/components/shared/page-header"
import { TemplateText } from "@/components/shared/template-text"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatNumber, formatPercent } from "@/lib/format"
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

export default async function RelatoriosPage() {
  const [funil, diaSemana, horario, campanhas, mensagens, produto, marca, persona, regiao] = await Promise.all([
    getFunil(),
    getDistribuicaoPorDiaSemana(),
    getDistribuicaoPorHorario(),
    getPerformancePorCampanha(),
    getPerformancePorMensagem(),
    getConversaoPorDimensao("produto"),
    getConversaoPorDimensao("marca"),
    getConversaoPorDimensao("persona"),
    getConversaoPorDimensao("regiao"),
  ])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Relatórios"
        descricao="Análise de conversão, melhores horários e desempenho por mensagem."
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Funil de conversão</CardTitle>
            <CardDescription>Do cadastro do lead até a qualificação.</CardDescription>
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
          <CardTitle>Conversão por segmento</CardTitle>
          <CardDescription>Percentual de leads qualificados em cada dimensão.</CardDescription>
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
            <CardDescription>Ordenado pela taxa de conversão em qualificados.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campanha</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Enviadas</TableHead>
                  <TableHead className="text-right">Resposta</TableHead>
                  <TableHead className="text-right">Conversão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campanhas.map((c) => (
                  <TableRow key={c.nome}>
                    <TableCell className="font-medium">{c.nome}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(c.leads)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(c.enviadas)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(c.taxaResposta)}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary" className="tabular-nums">
                        {formatPercent(c.taxaConversao)}
                      </Badge>
                    </TableCell>
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
