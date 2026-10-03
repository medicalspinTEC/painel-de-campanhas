"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Award,
  Bell,
  MessageCircleReply,
  Megaphone,
  PlayCircle,
  Send,
  StopCircle,
  Volume2,
  VolumeX,
} from "lucide-react"

import { listNotificacoesAction } from "@/app/actions/notificacoes"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { EventRow } from "@/services/events"
import { EVENT_TYPE_LABEL, type EventType } from "@/types"

const ICONES: Record<EventType, React.ReactNode> = {
  mensagem_enviada: <Send className="size-4" />,
  resposta: <MessageCircleReply className="size-4" />,
  removido_campanha: <Megaphone className="size-4" />,
  falha: <AlertTriangle className="size-4" />,
  campanha_iniciada: <PlayCircle className="size-4" />,
  campanha_encerrada: <StopCircle className="size-4" />,
}

const CORES: Record<EventType, string> = {
  mensagem_enviada: "bg-muted text-muted-foreground",
  resposta: "bg-chart-2/15 text-chart-2",
  removido_campanha: "bg-muted text-muted-foreground",
  falha: "bg-destructive/12 text-destructive",
  campanha_iniciada: "bg-chart-3/18 text-chart-3",
  campanha_encerrada: "bg-muted text-muted-foreground",
}

/*
 * Guardamos no navegador o instante em que o sino foi aberto pela última vez.
 * Tudo que aconteceu depois disso conta como "não lido" e alimenta o contador
 * — assim o badge é por usuário/dispositivo, sem precisar de coluna no banco.
 */
const STORAGE_KEY = "notificacoes:ultima-leitura"
const STORAGE_SOM = "notificacoes:som"
const SOM_NOTIFICACAO = "/sounds/notificacao.mp3"
const INTERVALO_ATUALIZACAO = 10_000
/** Envios da própria equipe/campanha não tocam o som: seriam centenas por disparo. */
const TIPOS_SEM_SOM: EventType[] = ["mensagem_enviada"]

export function NotificationBell({ notificacoes: iniciais }: { notificacoes: EventRow[] }) {
  const [notificacoes, setNotificacoes] = useState(iniciais)
  const [somAtivo, setSomAtivo] = useState(true)
  const idsVistos = useRef(new Set(iniciais.map((n) => n.id)))
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [aberto, setAberto] = useState(false)
  const [ultimaLeitura, setUltimaLeitura] = useState<number | null>(null)
  const [pronto, setPronto] = useState(false)

  // Lê o marcador de leitura só no cliente, evitando divergência de hidratação.
  useEffect(() => {
    const salvo = window.localStorage.getItem(STORAGE_KEY)
    setUltimaLeitura(salvo ? Number(salvo) : 0)
    setPronto(true)
  }, [])

  // Quando a página traz dados novos do servidor, aproveita sem tocar som.
  useEffect(() => {
    setNotificacoes(iniciais)
    iniciais.forEach((n) => idsVistos.current.add(n.id))
  }, [iniciais])

  // Preferência de som + "destrava" o áudio no primeiro clique (política de autoplay dos navegadores).
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_SOM) === "off") setSomAtivo(false)
    } catch {
      // Segue com o som ligado.
    }
    const audio = new Audio(SOM_NOTIFICACAO)
    audio.preload = "auto"
    audioRef.current = audio

    function destravar() {
      audio.muted = true
      audio
        .play()
        .then(() => {
          audio.pause()
          audio.currentTime = 0
        })
        .catch(() => {})
        .finally(() => {
          audio.muted = false
        })
      window.removeEventListener("pointerdown", destravar)
      window.removeEventListener("keydown", destravar)
    }
    window.addEventListener("pointerdown", destravar)
    window.addEventListener("keydown", destravar)
    return () => {
      window.removeEventListener("pointerdown", destravar)
      window.removeEventListener("keydown", destravar)
      audio.pause()
      audioRef.current = null
    }
  }, [])

  const somAtivoRef = useRef(somAtivo)
  useEffect(() => {
    somAtivoRef.current = somAtivo
  }, [somAtivo])

  const tocarSom = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !somAtivoRef.current) return
    audio.currentTime = 0
    void audio.play().catch(() => {
      // Navegador ainda bloqueando (sem interação prévia): ignora.
    })
  }, [])

  // Consulta novas notificações a cada 10 s e toca o som quando chega alguma.
  useEffect(() => {
    let cancelado = false
    async function atualizar() {
      const lista = await listNotificacoesAction().catch(() => null)
      if (cancelado || !lista) return
      const novas = lista.filter((n) => !idsVistos.current.has(n.id))
      if (novas.length === 0) return
      novas.forEach((n) => idsVistos.current.add(n.id))
      setNotificacoes(lista)
      if (novas.some((n) => !TIPOS_SEM_SOM.includes(n.tipo))) tocarSom()
    }
    const timer = window.setInterval(() => void atualizar(), INTERVALO_ATUALIZACAO)
    return () => {
      cancelado = true
      window.clearInterval(timer)
    }
  }, [tocarSom])

  function alternarSom() {
    const novo = !somAtivo
    setSomAtivo(novo)
    try {
      window.localStorage.setItem(STORAGE_SOM, novo ? "on" : "off")
    } catch {
      // Sem armazenamento: vale só até recarregar.
    }
    if (novo) tocarSom()
  }

  const naoLidas = useMemo(() => {
    if (ultimaLeitura === null) return 0
    return notificacoes.filter((n) => new Date(n.data).getTime() > ultimaLeitura).length
  }, [notificacoes, ultimaLeitura])

  function marcarComoLidas() {
    const agora = Date.now()
    window.localStorage.setItem(STORAGE_KEY, String(agora))
    setUltimaLeitura(agora)
  }

  function aoAbrir(estado: boolean) {
    setAberto(estado)
    // Ao fechar o painel, tudo que estava listado passa a contar como lido.
    if (!estado) marcarComoLidas()
  }

  const temNaoLidas = pronto && naoLidas > 0

  return (
    <Popover open={aberto} onOpenChange={aoAbrir}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon-sm" className="relative" />}
        aria-label={temNaoLidas ? `Notificações, ${naoLidas} não lidas` : "Notificações"}
      >
        <Bell className="size-4" />
        {temNaoLidas ? (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.625rem] font-semibold leading-4 text-destructive-foreground">
            {naoLidas > 99 ? "99+" : naoLidas}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex max-h-[min(32rem,calc(100vh-5rem))] w-[22rem] flex-col p-0"
      >
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Notificações</span>
            {temNaoLidas ? (
              <span className="rounded-full bg-primary/15 px-1.5 text-[0.6875rem] font-medium text-primary">
                {naoLidas} nova{naoLidas > 1 ? "s" : ""}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {temNaoLidas ? (
              <button
                type="button"
                onClick={marcarComoLidas}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Marcar como lidas
              </button>
            ) : null}
            <button
              type="button"
              onClick={alternarSom}
              aria-label={somAtivo ? "Desativar som das notificações" : "Ativar som das notificações"}
              aria-pressed={somAtivo}
              title={somAtivo ? "Som ligado" : "Som desligado"}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {somAtivo ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            </button>
          </div>
        </div>

        {notificacoes.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nenhuma notificação por aqui ainda.
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ul className="flex flex-col divide-y divide-border">
              {notificacoes.map((evento) => {
                const naoLida = ultimaLeitura !== null && new Date(evento.data).getTime() > ultimaLeitura
                return (
                  <li key={evento.id}>
                    <Link
                      href={`/leads/${evento.leadId}`}
                      onClick={() => setAberto(false)}
                      className={cn(
                        "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60",
                        naoLida && "bg-primary/5",
                      )}
                    >
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
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{evento.leadNome}</span>
                          {naoLida ? (
                            <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                          ) : null}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {EVENT_TYPE_LABEL[evento.tipo]}
                          {evento.campanhaNome ? ` · ${evento.campanhaNome}` : ""}
                        </span>
                        <p className="line-clamp-2 text-xs text-muted-foreground/80">{evento.descricao}</p>
                      </div>
                      <time
                        className="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums"
                        dateTime={evento.data}
                      >
                        {formatRelative(evento.data)}
                      </time>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <div className="shrink-0 border-t px-4 py-2">
          <Link
            href="/eventos"
            onClick={() => setAberto(false)}
            className="flex items-center justify-center text-xs font-medium text-primary hover:underline"
          >
            Ver todos os eventos
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
