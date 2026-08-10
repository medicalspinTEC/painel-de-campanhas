"use client"

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import type { SeriePonto } from "@/services/analytics"

const config = {
  enviadas: { label: "Mensagens enviadas", color: "var(--chart-1)" },
  respostas: { label: "Respostas", color: "var(--chart-3)" },
} satisfies ChartConfig

export function ActivityChart({ dados }: { dados: SeriePonto[] }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
      <AreaChart data={dados} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="fillEnviadas" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-enviadas)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-enviadas)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="fillRespostas" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-respostas)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-respostas)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} width={32} tickMargin={4} />
        <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
        <Area
          dataKey="enviadas"
          type="monotone"
          stroke="var(--color-enviadas)"
          fill="url(#fillEnviadas)"
          strokeWidth={2}
        />
        <Area
          dataKey="respostas"
          type="monotone"
          stroke="var(--color-respostas)"
          fill="url(#fillRespostas)"
          strokeWidth={2}
        />
      </AreaChart>
    </ChartContainer>
  )
}
