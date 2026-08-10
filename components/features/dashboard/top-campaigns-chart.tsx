"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import type { CampanhaPerformance } from "@/services/analytics"

const config = {
  taxaConversao: { label: "Conversão (%)", color: "var(--chart-1)" },
} satisfies ChartConfig

export function TopCampaignsChart({ dados }: { dados: CampanhaPerformance[] }) {
  const preparado = dados.slice(0, 6).map((c) => ({
    nome: c.nome.length > 22 ? `${c.nome.slice(0, 22)}…` : c.nome,
    taxaConversao: Number(c.taxaConversao.toFixed(1)),
  }))

  return (
    <ChartContainer config={config} className="aspect-auto h-[260px] w-full">
      <BarChart data={preparado} layout="vertical" margin={{ left: 0, right: 16 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" tickLine={false} axisLine={false} tickMargin={6} unit="%" />
        <YAxis
          type="category"
          dataKey="nome"
          tickLine={false}
          axisLine={false}
          width={150}
          tickMargin={4}
          className="text-[11px]"
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="taxaConversao" fill="var(--color-taxaConversao)" radius={[0, 6, 6, 0]} barSize={16} />
      </BarChart>
    </ChartContainer>
  )
}
