import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, CalendarClock, Hourglass, MessageSquare, Send, Users } from "lucide-react"

import { CampaignLeadsTable, type CampaignLeadItem } from "@/components/features/campaigns/campaign-leads-table"
import { CampaignRespondersTable } from "@/components/features/campaigns/campaign-responders-table"
import { CampaignResponses } from "@/components/features/campaigns/campaign-responses"
import { KpiCard } from "@/components/shared/kpi-card"
import { LinkButton } from "@/components/shared/link-button"
import { PageHeader } from "@/components/shared/page-header"
import { CampaignStatusBadge } from "@/components/shared/status-badges"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDate, formatNumber, formatPercent, renderTemplate } from "@/lib/format"
import { getCampaign, getCampaignResponders, getCampaignResponses, getCampaignSchedule, getIndividualLeadMessages } from "@/services/campaigns"
import { listLeads } from "@/services/leads"

export default async function CampanhaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [campanha, leads, agenda, respostas, respondentes] = await Promise.all([
    getCampaign(id),
    listLeads(),
    getCampaignSchedule(id),
    getCampaignResponses(id),
    getCampaignResponders(id),
  ])
  if (!campanha) notFound()
  const mensagensIndividuais = campanha.tipo === "individual" ? await getIndividualLeadMessages(id) : {}

  const leadsDaCampanha = leads.filter((l) => l.campanhasIds.includes(campanha.id))
  const temMensagens = campanha.mensagens.length > 0
  const itensLeads: CampaignLeadItem[] = leadsDaCampanha.map((lead) => {
    const schedule = agenda[lead.id]
    return {
      id: lead.id,
      nome: lead.nome,
      produto: lead.produto,
      status: lead.status,
      mensagensEnviadas: lead.mensagensEnviadas,
      ultimoContato: lead.ultimoContato,
      proximaMensagemEm: schedule?.proximaMensagemEm ?? null,
      aguardandoRecorrencia: schedule?.aguardandoRecorrencia ?? false,
      temMensagens: schedule?.temMensagens ?? temMensagens,
    }
  })
  const taxa = campanha.taxaResposta
  const filtros = Object.entries(campanha.filtros).filter(([, v]) => Boolean(v)) as [string, string][]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/campanhas"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Campanhas
        </Link>
        <PageHeader titulo={campanha.nome} descricao={campanha.descricao ?? "Sem descrição"}>
          <LinkButton variant="outline" href={`/campanhas/${campanha.id}/editar`}>
            Editar campanha
          </LinkButton>
        </PageHeader>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard titulo="Leads na campanha" valor={formatNumber(campanha.totalLeads)} icon={Users} />
        <KpiCard titulo="Faltam responder" valor={formatNumber(campanha.leadsPendentes)} icon={Hourglass} />
        <KpiCard titulo="Mensagens enviadas" valor={formatNumber(campanha.mensagensEnviadas)} icon={Send} />
        <KpiCard titulo="Taxa de resposta" valor={formatPercent(taxa)} icon={CalendarClock} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>{campanha.tipo === "individual" ? "Mensagens individuais" : "Sequência de mensagens"}</CardTitle>
            <CardDescription>
              {campanha.tipo === "individual"
                ? "Cada lead recebe apenas a mensagem escrita para ele, uma única vez."
                : `${campanha.mensagens.length} mensagens, reiniciando a cada ${campanha.recorrenciaDias} dias.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {campanha.tipo === "individual" ? (
              leadsDaCampanha.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum lead vinculado ainda.</p>
              ) : (
                leadsDaCampanha.map((lead) => {
                  const info = mensagensIndividuais[lead.id]
                  return (
                    <div key={lead.id} className="flex flex-col gap-1 rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{lead.nome}</span>
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {info?.enviadaEm ? `Enviada em ${formatDate(info.enviadaEm)}` : "Pendente"}
                        </span>
                      </div>
                      <p className="rounded-lg rounded-tl-sm bg-muted px-3 py-2 text-sm leading-relaxed">
                        {info?.mensagem ? renderTemplate(info.mensagem) : "Sem mensagem definida."}
                      </p>
                    </div>
                  )
                })
              )
            ) : (
              campanha.mensagens.map((mensagem, index) => (
                <div key={mensagem.id} className="flex gap-3">
                  <div className="flex flex-col items-center gap-1">
                    <span className="flex size-7 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary tabular-nums">
                      {index + 1}
                    </span>
                    {index < campanha.mensagens.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
                  </div>
                  <div className="flex flex-1 flex-col gap-1 pb-3">
                    <span className="text-xs text-muted-foreground">
                      Dia {mensagem.dia} · {mensagem.horario}
                    </span>
                    <p className="rounded-lg rounded-tl-sm bg-muted px-3 py-2 text-sm leading-relaxed">
                      {renderTemplate(mensagem.texto)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Detalhes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <Detalhe rotulo="Status">
              <CampaignStatusBadge status={campanha.status} />
            </Detalhe>
            <Detalhe rotulo="ID de importação">
              <span className="tabular-nums">{campanha.idImportacao}</span>
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                Use na coluna “campanha” da planilha
              </span>
            </Detalhe>
            <Detalhe rotulo="Tipo">
              {campanha.tipo === "individual" ? "Individual (uma mensagem por lead)" : "Padrão (sequência para todos)"}
            </Detalhe>
            <Detalhe rotulo="Recorrência">
              {campanha.tipo === "individual" ? "Disparo único, sem repetição" : `${campanha.recorrenciaDias} dias`}
            </Detalhe>
            <Detalhe rotulo="Criada em">{formatDate(campanha.criadoEm)}</Detalhe>
            <Detalhe rotulo="Data limite">
              {campanha.dataFinal ? formatDate(campanha.dataFinal) : "Sem data limite"}
            </Detalhe>
            <Detalhe rotulo="Filtros de público">
              {campanha.tipo === "individual" ? (
                <span className="text-muted-foreground">Seleção manual (sem filtros automáticos)</span>
              ) : filtros.length === 0 ? (
                <span className="text-muted-foreground">Todos os leads</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {filtros.map(([chave, valor]) => (
                    <Badge key={chave} variant="secondary">
                      {valor}
                    </Badge>
                  ))}
                </div>
              )}
            </Detalhe>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Leads vinculados</CardTitle>
          <CardDescription>
            {leadsDaCampanha.length} leads recebendo esta sequência. Use “Pular” para antecipar o próximo disparo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CampaignLeadsTable campanhaId={campanha.id} leads={itensLeads} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Leads que responderam</CardTitle>
          <CardDescription>
            {respondentes.length === 0
              ? "Assim que um lead responder, ele sai da sequência e aparece aqui."
              : `${formatNumber(respondentes.length)} ${respondentes.length === 1 ? "lead respondeu" : "leads responderam"} a esta campanha.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CampaignRespondersTable leads={respondentes} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Respostas recebidas</CardTitle>
          <CardDescription>
            {respostas.length === 0
              ? "Leads que responderem às mensagens desta campanha aparecem aqui."
              : `${formatNumber(respostas.length)} ${respostas.length === 1 ? "resposta registrada" : "respostas registradas"} nesta campanha.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CampaignResponses respostas={respostas} />
        </CardContent>
      </Card>
    </div>
  )
}

function Detalhe({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{rotulo}</span>
      <div className="font-medium">{children}</div>
    </div>
  )
}
