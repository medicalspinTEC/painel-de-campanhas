import { eventMeta } from "@/components/shared/status-badges"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { formatDateTime, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import { EVENT_TYPE_LABEL, type TimelineEvent } from "@/types"
import { History } from "lucide-react"

export function LeadTimeline({ eventos }: { eventos: TimelineEvent[] }) {
  if (eventos.length === 0) {
    return (
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <History />
          </EmptyMedia>
          <EmptyTitle>Nenhum evento registrado</EmptyTitle>
          <EmptyDescription>Assim que o lead entrar em uma campanha, os envios aparecem aqui.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ol className="flex flex-col">
      {eventos.map((evento, index) => {
        const meta = eventMeta[evento.tipo]
        const Icon = meta.icon
        const ultimo = index === eventos.length - 1
        return (
          <li key={evento.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border",
                  evento.sucesso ? meta.classes : "border-destructive/30 bg-destructive/10 text-destructive",
                )}
              >
                <Icon className="size-4" />
              </span>
              {!ultimo ? <span className="w-px flex-1 bg-border" aria-hidden /> : null}
            </div>
            <div className={cn("flex flex-1 flex-col gap-1", ultimo ? "pb-1" : "pb-5")}>
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="text-sm font-medium">{EVENT_TYPE_LABEL[evento.tipo]}</span>
                <span className="text-xs text-muted-foreground">{formatRelative(evento.data)}</span>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{evento.descricao}</p>
              {evento.detalhes ? (
                <p className="whitespace-pre-line rounded-md bg-muted px-3 py-2 text-sm leading-relaxed text-foreground">
                  {evento.detalhes}
                </p>
              ) : null}
              <span className="text-xs tabular-nums text-muted-foreground">{formatDateTime(evento.data)}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
