import Link from "next/link"

import { eventMeta } from "@/components/shared/status-badges"
import { formatRelative } from "@/lib/format"
import type { EventRow } from "@/services/events"
import { EVENT_TYPE_LABEL } from "@/types"

export function RecentEvents({ eventos }: { eventos: EventRow[] }) {
  return (
    <ul className="flex flex-col">
      {eventos.map((evento) => {
        const meta = eventMeta[evento.tipo]
        const Icon = meta.icon
        return (
          <li key={evento.id} className="flex items-start gap-3 border-b py-3 last:border-b-0 last:pb-0">
            <span
              className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border ${meta.classes}`}
            >
              <Icon className="size-3.5" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-x-2">
                <Link
                  href={`/leads/${evento.leadId}`}
                  className="truncate text-sm font-medium hover:text-primary hover:underline"
                >
                  {evento.leadNome}
                </Link>
                <span className="text-xs text-muted-foreground">{EVENT_TYPE_LABEL[evento.tipo]}</span>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {evento.campanhaNome ?? "Sem campanha"} · {formatRelative(evento.data)}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
