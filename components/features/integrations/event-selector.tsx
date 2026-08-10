"use client"

import { WEBHOOK_EVENTS, WEBHOOK_EVENT_GROUPS } from "@/lib/webhook-events"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"

/**
 * Seleção dos eventos assinados por um webhook. Expõe todos os eventos do app,
 * agrupados por domínio, com atalho para marcar tudo de uma vez ou por grupo.
 */
export function EventSelector({
  selecionados,
  onChange,
}: {
  selecionados: string[]
  onChange: (eventos: string[]) => void
}) {
  const total = WEBHOOK_EVENTS.length
  const todosMarcados = selecionados.length === total
  // Estado intermediário do checkbox mestre quando há seleção parcial.
  const algunsMarcados = selecionados.length > 0 && !todosMarcados

  function alternarTodos(marcar: boolean) {
    onChange(marcar ? WEBHOOK_EVENTS.map((evento) => evento.key) : [])
  }

  function alternarEvento(key: string, marcar: boolean) {
    onChange(marcar ? [...selecionados, key] : selecionados.filter((item) => item !== key))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
        <label htmlFor="todos-eventos" className="flex items-center gap-2.5 text-sm font-medium">
          <Checkbox
            id="todos-eventos"
            checked={todosMarcados}
            indeterminate={algunsMarcados}
            onCheckedChange={alternarTodos}
          />
          Todos os eventos do app
        </label>
        <Badge variant="secondary">
          {selecionados.length}/{total}
        </Badge>
      </div>

      <div className="flex max-h-72 flex-col gap-4 overflow-y-auto rounded-lg border p-3">
        {WEBHOOK_EVENT_GROUPS.map((grupo, indice) => {
          const eventosDoGrupo = WEBHOOK_EVENTS.filter((evento) => evento.grupo === grupo)
          const chavesDoGrupo = eventosDoGrupo.map((evento) => evento.key)
          const grupoCompleto = chavesDoGrupo.every((key) => selecionados.includes(key))

          function alternarGrupo() {
            onChange(
              grupoCompleto
                ? selecionados.filter((key) => !chavesDoGrupo.includes(key))
                : Array.from(new Set([...selecionados, ...chavesDoGrupo])),
            )
          }

          return (
            <div key={grupo} className="flex flex-col gap-2.5">
              {indice > 0 ? <Separator className="mb-1" /> : null}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{grupo}</span>
                <button
                  type="button"
                  onClick={alternarGrupo}
                  className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  {grupoCompleto ? "Limpar grupo" : "Marcar grupo"}
                </button>
              </div>

              {eventosDoGrupo.map((evento) => (
                <label
                  key={evento.key}
                  htmlFor={evento.key}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1 hover:bg-muted/60"
                >
                  <Checkbox
                    id={evento.key}
                    className="mt-0.5"
                    checked={selecionados.includes(evento.key)}
                    onCheckedChange={(marcar) => alternarEvento(evento.key, marcar === true)}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium leading-tight">{evento.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">{evento.key}</span>
                    <span className="text-xs text-muted-foreground leading-relaxed">{evento.descricao}</span>
                  </span>
                </label>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
