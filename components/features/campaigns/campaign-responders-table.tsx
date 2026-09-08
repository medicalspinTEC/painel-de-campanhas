import Link from "next/link"
import { MessageCircleReply } from "lucide-react"

import { LeadStatusBadge } from "@/components/shared/status-badges"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format"
import type { CampaignResponder } from "@/services/campaigns"

/**
 * Uma linha por lead que já respondeu a esta campanha (agregado a partir dos
 * eventos de resposta). Diferente da seção "Respostas recebidas" — que lista
 * cada evento de resposta em ordem cronológica —, aqui cada lead aparece uma
 * única vez, com o status atual dele e quando respondeu pela última vez.
 */
export function CampaignRespondersTable({ leads }: { leads: CampaignResponder[] }) {
  if (leads.length === 0) {
    return (
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircleReply />
          </EmptyMedia>
          <EmptyTitle>Nenhum lead respondeu ainda</EmptyTitle>
          <EmptyDescription>
            Assim que um lead responder, ele sai da sequência e passa a aparecer aqui.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Lead</TableHead>
            <TableHead className="hidden sm:table-cell">Telefone</TableHead>
            <TableHead>Status atual</TableHead>
            <TableHead className="text-right">Respostas</TableHead>
            <TableHead className="text-right">Última resposta</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((lead) => (
            <TableRow key={lead.leadId}>
              <TableCell>
                {lead.leadNome === "Lead removido" ? (
                  <span className="text-muted-foreground">{lead.leadNome}</span>
                ) : (
                  <Link href={`/leads/${lead.leadId}`} className="font-medium hover:underline">
                    {lead.leadNome}
                  </Link>
                )}
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground tabular-nums sm:table-cell">
                {lead.leadTelefone || "—"}
              </TableCell>
              <TableCell>
                <LeadStatusBadge status={lead.leadStatus} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(lead.totalRespostas)}</TableCell>
              <TableCell className="text-right text-muted-foreground" title={formatDateTime(lead.ultimaRespostaEm)}>
                {formatRelative(lead.ultimaRespostaEm)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
