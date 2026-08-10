import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react"
import type { ComponentType } from "react"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function KpiCard({
  titulo,
  valor,
  variacao,
  icon: Icon,
  descricao,
}: {
  titulo: string
  valor: string
  variacao?: number
  icon: ComponentType<{ className?: string }>
  descricao?: string
}) {
  const positivo = (variacao ?? 0) > 0
  const neutro = !variacao
  const TrendIcon = neutro ? Minus : positivo ? ArrowUpRight : ArrowDownRight

  return (
    <Card className="gap-0 py-4">
      <CardContent className="flex flex-col gap-3 px-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">{titulo}</span>
          <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="size-3.5" />
          </span>
        </div>
        <div className="flex items-end justify-between gap-2">
          <span className="text-2xl font-semibold tabular-nums tracking-tight">{valor}</span>
          {variacao !== undefined ? (
            <span
              className={cn(
                "flex items-center gap-0.5 text-xs font-medium",
                neutro ? "text-muted-foreground" : positivo ? "text-primary" : "text-destructive",
              )}
            >
              <TrendIcon className="size-3" />
              {neutro ? "estável" : `${Math.abs(variacao).toFixed(1).replace(".", ",")}%`}
            </span>
          ) : null}
        </div>
        {descricao ? <p className="text-xs text-muted-foreground leading-relaxed">{descricao}</p> : null}
      </CardContent>
    </Card>
  )
}
