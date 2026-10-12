import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Landmark, MessageCircleReply, NotebookPen, Send, Sparkles } from "lucide-react"

import { LeadMessageDialog } from "@/components/features/leads/lead-message-dialog"
import { LeadCnpjNota } from "@/components/features/leads/lead-cnpj-nota"
import { LeadNotes } from "@/components/features/leads/lead-notes"
import { LeadTimeline } from "@/components/features/leads/lead-timeline"
import { LinkButton } from "@/components/shared/link-button"
import { LeadStatusBadge } from "@/components/shared/status-badges"
import { LeadAvatar } from "@/components/shared/lead-avatar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { cnpjMascara } from "@/lib/cnpj"
import { formatDateTime, formatRelative, initials } from "@/lib/format"
import { listInstanceOptions } from "@/services/evolution"
import { getLead, getLeadTimeline } from "@/services/leads"
import { requireSecao } from "@/lib/session"
import { lerNotaCnpj } from "@/services/cnpj"
import { getCrmPluginAtivo } from "@/services/settings"

export default async function LeadDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSecao("leads")
  const { id } = await params
  const [lead, eventos, instancias, crmAtivo] = await Promise.all([
    getLead(id),
    getLeadTimeline(id),
    listInstanceOptions(),
    getCrmPluginAtivo().catch(() => false),
  ])
  if (!lead) notFound()
  // Nota do CNPJ (consulta na Receita): só existe com o plugin CRM ativo.
  const notaCnpj = crmAtivo ? await lerNotaCnpj(id).catch(() => null) : null

  const atributos = [
    { label: "Produto", valor: lead.produto },
    { label: "Marca", valor: lead.marca },
    { label: "Persona", valor: lead.persona },
    { label: "Região", valor: lead.regiao },
    { label: "Negócio", valor: lead.negocio ?? "—" },
    { label: "Atividade", valor: lead.atividade ?? "—" },
    ...(crmAtivo ? [{ label: "CNPJ", valor: lead.cnpj ? cnpjMascara(lead.cnpj) : "—" }] : []),
    { label: "Telefone", valor: lead.telefone },
    { label: "Cadastrado em", valor: formatDateTime(lead.criadoEm) },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div>
        <LinkButton variant="ghost" size="sm" href="/leads" className="-ml-2">
          <ArrowLeft className="size-4" />
          Voltar para leads
        </LinkButton>
      </div>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <Card className="xl:w-80 xl:shrink-0">
          <CardHeader className="items-center">
            <div className="flex items-center gap-3">
              <LeadAvatar leadId={lead.id} nome={lead.nome} telefone={lead.telefone} className="size-11" fallbackClassName="bg-primary/12 text-primary" />
              <div className="flex flex-col gap-1">
                <CardTitle className="text-base">{lead.nome}</CardTitle>
                <LeadStatusBadge status={lead.status} className="w-fit" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <LeadMessageDialog leadId={lead.id} leadNome={lead.nome} instancias={instancias} />

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 px-3 py-2">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Send className="size-3.5" />
                  Enviadas
                </span>
                <span className="text-lg font-semibold tabular-nums">{lead.mensagensEnviadas}</span>
              </div>
              <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 px-3 py-2">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MessageCircleReply className="size-3.5" />
                  Respostas
                </span>
                <span className="text-lg font-semibold tabular-nums">{lead.respostas}</span>
              </div>
            </div>

            <Separator />

            <dl className="flex flex-col gap-2.5">
              {atributos.map((attr) => (
                <div key={attr.label} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="text-muted-foreground">{attr.label}</dt>
                  <dd className="text-right font-medium">{attr.valor}</dd>
                </div>
              ))}
            </dl>

            <Separator />

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Campanhas vinculadas</span>
              {lead.campanhasNomes.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {lead.campanhasNomes.map((nome) => (
                    <span key={nome} className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium">
                      {nome}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Nenhuma campanha vinculada</span>
              )}
              {lead.entradaCampanhaEm ? (
                <span className="text-xs text-muted-foreground">
                  Entrou {formatRelative(lead.entradaCampanhaEm)}
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-1 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <NotebookPen className="size-4 text-primary" />
                Notas
              </CardTitle>
              <CardDescription>
                Anotações internas da equipe. Opcionais e editáveis a qualquer momento.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LeadNotes leadId={lead.id} notas={lead.notas} />
            </CardContent>
          </Card>

          {crmAtivo && notaCnpj ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Landmark className="size-4 text-primary" />
                  Nota do CNPJ
                </CardTitle>
                <CardDescription>
                  Dados da empresa na Receita Federal. A consulta é manual: use o botão para buscar ou atualizar.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LeadCnpjNota
                  key={`${notaCnpj.cnpj ?? "sem"}-${notaCnpj.consultadoEm ?? "nunca"}`}
                  leadId={lead.id}
                  cnpj={notaCnpj.cnpj}
                  dadosIniciais={notaCnpj.dados}
                  consultadoEmInicial={notaCnpj.consultadoEm}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                Histórico de follow-up
              </CardTitle>
              <CardDescription>
                Todos os envios automáticos, respostas e mudanças de estágio do lead.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LeadTimeline eventos={eventos} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
