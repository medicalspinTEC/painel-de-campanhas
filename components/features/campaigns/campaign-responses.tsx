import Link from "next/link"
import { MessageCircleReply } from "lucide-react"

import { LeadStatusBadge } from "@/components/shared/status-badges"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { formatDateTime, formatRelative, initials } from "@/lib/format"
import type { CampaignResponse } from "@/services/campaigns"

export function CampaignResponses({ respostas }: { respostas: CampaignResponse[] }) {
  if (respostas.length === 0) {
    return (
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircleReply />
          </EmptyMedia>
          <EmptyTitle>Nenhuma resposta ainda</EmptyTitle>
          <EmptyDescription>
            Assim que um lead responder a uma mensagem desta campanha, ele aparece aqui.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ol className="flex flex-col gap-3">
      {respostas.map((resposta) => (
        <li
          key={resposta.id}
          className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-start sm:gap-3"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-chart-3/15 text-xs font-semibold text-chart-3">
            {initials(resposta.leadNome)}
          </span>
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link href={`/leads/${resposta.leadId}`} className="text-sm font-medium hover:underline">
                {resposta.leadNome}
              </Link>
              <LeadStatusBadge status={resposta.leadStatus} />
              {resposta.leadTelefone ? (
                <span className="text-xs text-muted-foreground tabular-nums">{resposta.leadTelefone}</span>
              ) : null}
            </div>
            {resposta.detalhes ? (
              <p className="whitespace-pre-line rounded-md bg-muted px-3 py-2 text-sm leading-relaxed text-foreground">
                {resposta.detalhes}
              </p>
            ) : null}
            <span className="text-xs tabular-nums text-muted-foreground">
              {formatDateTime(resposta.data)} · {formatRelative(resposta.data)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  )
}
