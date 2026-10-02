"use client"

import { Check, Moon, Sun } from "lucide-react"

import { cn } from "@/lib/utils"
import { TEMAS_APP, type TemaApp, type TemaPrevia } from "@/lib/temas"

/** Metade da miniatura: uma versão reduzida da tela no modo claro ou escuro. */
function MetadePrevia({ cores, modo }: { cores: TemaPrevia; modo: "claro" | "escuro" }) {
  const Icone = modo === "claro" ? Sun : Moon
  return (
    <div className="relative flex flex-1 flex-col gap-1.5 p-2.5" style={{ background: cores.background }}>
      <Icone className="absolute right-1.5 top-1.5 size-3 opacity-60" style={{ color: cores.foreground }} aria-hidden />
      <div
        className="flex flex-col gap-1.5 rounded-md p-1.5 shadow-xs"
        style={{ background: cores.card, border: `1px solid color-mix(in oklch, ${cores.foreground} 12%, transparent)` }}
      >
        <div className="h-1.5 w-8 rounded-full" style={{ background: cores.foreground, opacity: 0.7 }} />
        <div className="h-1 w-12 rounded-full" style={{ background: cores.muted }} />
        <div className="mt-0.5 flex items-center gap-1">
          <span className="h-3.5 w-9 rounded-sm" style={{ background: cores.primary }} />
          <span className="h-3.5 w-3.5 rounded-sm" style={{ background: cores.accent }} />
        </div>
      </div>
      <div className="flex gap-1">
        <span className="h-1.5 flex-1 rounded-full" style={{ background: cores.primary }} />
        <span className="h-1.5 flex-1 rounded-full" style={{ background: cores.chart_2 }} />
        <span className="h-1.5 flex-1 rounded-full" style={{ background: cores.chart_3 }} />
      </div>
    </div>
  )
}

export function TemaPicker({ valor, onChange }: { valor: TemaApp; onChange: (tema: TemaApp) => void }) {
  return (
    <div role="radiogroup" aria-label="Tema do aplicativo" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {TEMAS_APP.map((tema) => {
        const selecionado = tema.id === valor
        return (
          <button
            key={tema.id}
            type="button"
            role="radio"
            aria-checked={selecionado}
            onClick={() => onChange(tema.id)}
            className={cn(
              "group flex flex-col overflow-hidden rounded-xl border bg-card text-left transition-all outline-none",
              "hover:border-primary/50 focus-visible:ring-3 focus-visible:ring-ring/50",
              selecionado ? "border-primary ring-2 ring-primary/30" : "border-border",
            )}
          >
            <div className="flex h-24 divide-x divide-border/60 border-b">
              <MetadePrevia cores={tema.previa.claro} modo="claro" />
              <MetadePrevia cores={tema.previa.escuro} modo="escuro" />
            </div>
            <div className="flex items-start justify-between gap-3 p-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{tema.nome}</span>
                <span className="text-xs text-muted-foreground">{tema.descricao}</span>
              </div>
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                  selecionado ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent",
                )}
                aria-hidden
              >
                <Check className="size-3" />
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
