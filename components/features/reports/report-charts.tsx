"use client"

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import type { DimensaoPerformance, DistribuicaoPonto, FunilPonto } from "@/services/analytics"

const configTaxa = {
  taxa: { label: "Taxa de resposta", color: "var(--chart-1)" },
} satisfies ChartConfig

export function DistribuicaoChart({ dados }: { dados: DistribuicaoPonto[] }) {
  return (
    <ChartContainer config={configTaxa} className="h-56 w-full">
      <BarChart data={dados} margin={{ left: -16, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} unit="%" />
        <ChartTooltip
          content={<ChartTooltipContent formatter={(value) => `${Number(value).toFixed(1)}%`} />}
        />
        <Bar dataKey="taxa" fill="var(--color-taxa)" radius={[6, 6, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ChartContainer>
  )
}

const configConversao = {
  taxaConversao: { label: "Conversão", color: "var(--chart-1)" },
} satisfies ChartConfig

export function DimensaoChart({ dados }: { dados: DimensaoPerformance[] }) {
  return (
    <ChartContainer config={configConversao} className="h-64 w-full">
      <BarChart data={dados} layout="vertical" margin={{ left: 8, right: 24 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} unit="%" />
        <YAxis type="category" dataKey="chave" tickLine={false} axisLine={false} width={120} fontSize={11} />
        <ChartTooltip
          content={<ChartTooltipContent formatter={(value) => `${Number(value).toFixed(1)}%`} />}
        />
        <Bar dataKey="taxaConversao" fill="var(--color-taxaConversao)" radius={[0, 6, 6, 0]} maxBarSize={28} />
      </BarChart>
    </ChartContainer>
  )
}

const configFunil = {
  total: { label: "Leads", color: "var(--chart-1)" },
} satisfies ChartConfig

/** Progressão monocromática: etapas mais avançadas ficam mais suaves. */
const OPACIDADES = [1, 0.82, 0.64, 0.46, 0.3]

export function FunilChart({ dados }: { dados: FunilPonto[] }) {
  return (
    <ChartContainer config={configFunil} className="h-64 w-full">
      <BarChart data={dados} layout="vertical" margin={{ left: 8, right: 24 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis type="category" dataKey="etapa" tickLine={false} axisLine={false} width={128} fontSize={11} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="total" fill="var(--color-total)" radius={[0, 6, 6, 0]} maxBarSize={30}>
          {dados.map((ponto, index) => (
            <Cell
              key={ponto.etapa}
              fill="var(--color-total)"
              fillOpacity={OPACIDADES[index] ?? 0.3}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
