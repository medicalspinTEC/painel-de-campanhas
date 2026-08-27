"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Award, MessageCircleReply, PlayCircle, Search, Send, StopCircle } from "lucide-react"

import { SelectField } from "@/components/shared/select-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { formatDateTime, formatDayLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { EventRow } from "@/services/events"
import { EVENT_TYPE_LABEL, type EventType } from "@/types"

const ICONES: Record<EventType, React.ReactNode> = {
  mensagem_enviada: <Send className="size-4" />,
  resposta: <MessageCircleReply className="size-4" />,
  falha: <AlertTriangle className="size-4" />,
  campanha_iniciada: <PlayCircle className="size-4" />,
  campanha_encerrada: <StopCircle className="size-4" />,
}

const CORES: Record<EventType, string> = {
  mensagem_enviada: "bg-muted text-muted-foreground",
  resposta: "bg-chart-2/15 text-chart-2",
  falha: "bg-destructive/12 text-destructive",
  campanha_iniciada: "bg-chart-3/18 text-chart-3",
  campanha_encerrada: "bg-muted text-muted-foreground",
}

const TIPOS = Object.keys(EVENT_TYPE_LABEL) as EventType[]

/** Quantidade de eventos renderizada por bloco. */
const PAGINA = 60

export function EventsFeed({ eventos }: { eventos: EventRow[] }) {
  const [busca, setBusca] = useState("")
  const [tipo, setTipo] = useState("todos")
  const [campanha, setCampanha] = useState("todas")

  const campanhas = useMemo(
    () => Array.from(new Set(eventos.map((e) => e.campanhaNome).filter(Boolean) as string[])).sort(),
    [eventos],
  )

  const filtrados = useMemo(
    () =>
      eventos.filter((e) => {
        if (tipo !== "todos" && e.tipo !== tipo) return false
        if (campanha !== "todas" && e.campanhaNome !== campanha) return false
        if (busca) {
          const termo = busca.toLowerCase()
          if (!e.leadNome.toLowerCase().includes(termo) && !e.descricao.toLowerCase().includes(termo)) return false
        }
        return true
      }),
    [eventos, tipo, campanha, busca],
  )

  /*
   * Renderiza a lista em blocos. Sem isso, centenas de eventos entram no HTML
   * inicial de uma só vez e atrasam a primeira pintura.
   */
  const [visiveis, setVisiveis] = useState(PAGINA)

  // Volta ao início da lista quando os filtros mudam.
  useEffect(() => {
    setVisiveis(PAGINA)
  }, [busca, tipo, campanha])

  const exibidos = useMemo(() => filtrados.slice(0, visiveis), [filtrados, visiveis])
  const restantes = filtrados.length - exibidos.length

  const agrupados = useMemo(() => {
    const mapa = new Map<string, EventRow[]>()
    for (const evento of exibidos) {
      const chave = new Date(evento.data).toDateString()
      const lista = mapa.get(chave) ?? []
      lista.push(evento)
      mapa.set(chave, lista)
    }
    return Array.from(mapa.entries())
  }, [exibidos])

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <InputGroup className="sm:max-w-xs">
            <InputGroupAddon>
              <Search className="size-4" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Buscar por lead ou descrição"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Buscar eventos"
            />
          </InputGroup>
          <SelectField
            value={tipo}
            onValueChange={setTipo}
            opcoes={[
              { value: "todos", label: "Todos os tipos" },
              ...TIPOS.map((t) => ({ value: t, label: EVENT_TYPE_LABEL[t] })),
            ]}
          />
          <SelectField
            value={campanha}
            onValueChange={setCampanha}
            opcoes={[
              { value: "todas", label: "Todas as campanhas" },
              ...campanhas.map((c) => ({ value: c, label: c })),
            ]}
          />
          <span className="text-sm text-muted-foreground sm:ml-auto">{filtrados.length} eventos</span>
        </CardContent>
      </Card>

      {agrupados.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum evento encontrado com os filtros atuais.
          </CardContent>
        </Card>
      ) : (
        agrupados.map(([dia, lista]) => (
          <section key={dia} className="flex flex-col gap-2">
            <h2 className="sticky top-14 z-10 -mx-1 bg-background/95 px-1 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
              {formatDayLabel(lista[0].data)}
            </h2>
            <Card>
              <CardContent className="flex flex-col divide-y divide-border p-0">
                {lista.map((evento) => (
                  <div key={evento.id} className="flex items-start gap-3 px-4 py-3">
                    <span
                      className={cn(
                        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                        CORES[evento.tipo],
                      )}
                      aria-hidden
                    >
                      {ICONES[evento.tipo]}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/leads/${evento.leadId}`} className="text-sm font-medium hover:underline">
                          {evento.leadNome}
                        </Link>
                        <Badge variant="outline" className="text-[0.6875rem]">
                          {EVENT_TYPE_LABEL[evento.tipo]}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{evento.descricao}</p>
                      {evento.detalhes ? (
                        <p className="text-xs text-muted-foreground/80">{evento.detalhes}</p>
                      ) : null}
                      {evento.campanhaNome ? (
                        <span className="text-xs text-muted-foreground">
                          {evento.campanhaNome}
                          {evento.mensagemResumo ? ` · ${evento.mensagemResumo}` : ""}
                        </span>
                      ) : null}
                    </div>
                    <time
                      className="shrink-0 text-xs text-muted-foreground tabular-nums"
                      dateTime={evento.data}
                      title={formatDateTime(evento.data)}
                    >
                      {new Date(evento.data).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </time>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        ))
      )}

      {restantes > 0 ? (
        <Button
          variant="outline"
          className="self-center"
          onClick={() => setVisiveis((v) => v + PAGINA)}
        >
          {`Carregar mais (${restantes} restantes)`}
        </Button>
      ) : null}
    </div>
  )
}
