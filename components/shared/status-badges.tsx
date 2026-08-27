import {
  CheckCircle2,
  CircleDot,
  Flag,
  MessageCircleReply,
  PauseCircle,
  Send,
  TriangleAlert,
} from "lucide-react"
import type { ComponentType } from "react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  CAMPAIGN_STATUS_LABEL,
  EVENT_TYPE_LABEL,
  LEAD_STATUS_LABEL,
  type CampaignStatus,
  type EventType,
  type LeadStatus,
} from "@/types"

const leadStyles: Record<LeadStatus, string> = {
  novo: "border-border bg-muted text-muted-foreground",
  em_campanha: "border-chart-2/30 bg-chart-2/12 text-chart-2",
  respondeu: "border-chart-3/35 bg-chart-3/15 text-chart-3",
  encerrado: "border-border bg-secondary text-secondary-foreground",
}

export function LeadStatusBadge({ status, className }: { status: LeadStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1", leadStyles[status], className)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {LEAD_STATUS_LABEL[status]}
    </Badge>
  )
}

const campaignStyles: Record<CampaignStatus, string> = {
  ativa: "border-primary/30 bg-primary/12 text-primary",
  pausada: "border-chart-3/35 bg-chart-3/15 text-chart-3",
  encerrada: "border-border bg-secondary text-secondary-foreground",
  rascunho: "border-border bg-muted text-muted-foreground",
}

export function CampaignStatusBadge({ status, className }: { status: CampaignStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1", campaignStyles[status], className)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {CAMPAIGN_STATUS_LABEL[status]}
    </Badge>
  )
}

export const eventMeta: Record<EventType, { icon: ComponentType<{ className?: string }>; classes: string }> = {
  mensagem_enviada: { icon: Send, classes: "border-chart-2/30 bg-chart-2/12 text-chart-2" },
  falha: { icon: TriangleAlert, classes: "border-destructive/30 bg-destructive/10 text-destructive" },
  resposta: { icon: MessageCircleReply, classes: "border-chart-3/35 bg-chart-3/15 text-chart-3" },
  campanha_iniciada: { icon: Flag, classes: "border-border bg-muted text-muted-foreground" },
  campanha_encerrada: { icon: PauseCircle, classes: "border-border bg-secondary text-secondary-foreground" },
}

export function EventTypeBadge({ tipo, className }: { tipo: EventType; className?: string }) {
  const meta = eventMeta[tipo] ?? { icon: CircleDot, classes: "" }
  const Icon = meta.icon
  return (
    <Badge variant="outline" className={cn("gap-1", meta.classes, className)}>
      <Icon className="size-3" />
      {EVENT_TYPE_LABEL[tipo]}
    </Badge>
  )
}
