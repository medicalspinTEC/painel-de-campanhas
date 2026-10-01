"use client"

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowRightLeft, Megaphone, MoreHorizontal, Phone, Search, X } from "lucide-react"

import { moveKanbanLeadAction } from "@/app/actions/kanban"
import { LeadRespostaDialog } from "@/components/shared/lead-resposta-dialog"
import { PageHeader } from "@/components/shared/page-header"
import { SelectField, type OpcaoSelect } from "@/components/shared/select-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { KanbanBoardData, KanbanLead } from "@/services/kanban"
import { CAMPAIGN_STATUS_LABEL, LEAD_STATUS_LABEL, type LeadStatus } from "@/types"

const COLUNAS = Object.keys(LEAD_STATUS_LABEL) as LeadStatus[]

/** Cor de cada coluna, alinhada aos badges de status que já existem no painel. */
const COR_COLUNA: Record<LeadStatus, { ponto: string; topo: string }> = {
  novo: { ponto: "bg-muted-foreground", topo: "border-t-muted-foreground/60" },
  em_campanha: { ponto: "bg-chart-2", topo: "border-t-chart-2" },
  sem_campanha: { ponto: "bg-chart-4", topo: "border-t-chart-4" },
  respondeu: { ponto: "bg-chart-3", topo: "border-t-chart-3" },
  encerrado: { ponto: "bg-secondary-foreground/60", topo: "border-t-secondary-foreground/50" },
}

const DISTANCIA_MOUSE = 5
const DISTANCIA_TOQUE = 10
const ESPERA_TOQUE_MS = 280
const BORDA_ROLAGEM = 56

/* ------------------------------------------------------------------ */
/* Arrasto por eventos de ponteiro (mouse, caneta e toque, sem biblioteca) */
/* ------------------------------------------------------------------ */

type EstadoArrasto = {
  lead: KanbanLead
  largura: number
  x: number
  y: number
  dx: number
  dy: number
  sobre: LeadStatus | null
}

type Sessao = {
  lead: KanbanLead
  pointerId: number
  tipo: string
  x: number
  y: number
  x0: number
  y0: number
  dx: number
  dy: number
  largura: number
  ativo: boolean
  timer: number | null
  raf: number | null
}

type OpcoesArrasto = {
  aoSoltar: (leadId: string, destino: LeadStatus) => void
}

function colunaSob(x: number, y: number): LeadStatus | null {
  const coluna = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-coluna]")
  const status = coluna?.dataset.coluna
  return status && Object.hasOwn(LEAD_STATUS_LABEL, status) ? (status as LeadStatus) : null
}

function useArrastoDeCards(scrollRef: RefObject<HTMLDivElement | null>, opcoes: OpcoesArrasto) {
  const [arrasto, setArrasto] = useState<EstadoArrasto | null>(null)
  const fantasmaRef = useRef<HTMLDivElement | null>(null)
  const opcoesRef = useRef(opcoes)
  const acabouDeArrastarRef = useRef(false)

  useEffect(() => {
    opcoesRef.current = opcoes
  })

  // O motor vive fora do ciclo de render: os listeners precisam de identidade
  // estável para serem removidos, e a posição do cartão não pode causar render.
  const [motor] = useState(() => {
    let sessao: Sessao | null = null
    let sobreAtual: LeadStatus | null = null
    let estiloAnterior = { userSelect: "", cursor: "" }

    function posicionarFantasma() {
      const s = sessao
      const el = fantasmaRef.current
      if (!s || !el) return
      el.style.transform = `translate3d(${s.x - s.dx}px, ${s.y - s.dy}px, 0) rotate(2deg)`
    }

    function atualizarSobre() {
      const s = sessao
      if (!s) return
      const novo = colunaSob(s.x, s.y)
      if (novo === sobreAtual) return
      sobreAtual = novo
      setArrasto((atual) => (atual ? { ...atual, sobre: novo } : atual))
    }

    function loopRolagem() {
      const s = sessao
      if (!s || !s.ativo) return

      const quadro = scrollRef.current
      if (quadro) {
        const r = quadro.getBoundingClientRect()
        if (s.x < r.left + BORDA_ROLAGEM) {
          quadro.scrollLeft -= Math.ceil(((r.left + BORDA_ROLAGEM - s.x) / BORDA_ROLAGEM) * 18)
        } else if (s.x > r.right - BORDA_ROLAGEM) {
          quadro.scrollLeft += Math.ceil(((s.x - (r.right - BORDA_ROLAGEM)) / BORDA_ROLAGEM) * 18)
        }
      }

      const corpo = document.elementFromPoint(s.x, s.y)?.closest<HTMLElement>("[data-coluna-corpo]")
      if (corpo) {
        const r = corpo.getBoundingClientRect()
        if (s.y < r.top + BORDA_ROLAGEM) corpo.scrollTop -= Math.ceil(((r.top + BORDA_ROLAGEM - s.y) / BORDA_ROLAGEM) * 14)
        else if (s.y > r.bottom - BORDA_ROLAGEM) corpo.scrollTop += Math.ceil(((s.y - (r.bottom - BORDA_ROLAGEM)) / BORDA_ROLAGEM) * 14)
      }

      atualizarSobre()
      s.raf = requestAnimationFrame(loopRolagem)
    }

    function ativar() {
      const s = sessao
      if (!s || s.ativo) return
      s.ativo = true
      sobreAtual = colunaSob(s.x, s.y)
      estiloAnterior = { userSelect: document.body.style.userSelect, cursor: document.body.style.cursor }
      document.body.style.userSelect = "none"
      document.body.style.cursor = "grabbing"
      if (s.tipo === "touch") navigator.vibrate?.(10)
      setArrasto({
        lead: s.lead,
        largura: s.largura,
        x: s.x,
        y: s.y,
        dx: s.dx,
        dy: s.dy,
        sobre: sobreAtual,
      })
      s.raf = requestAnimationFrame(loopRolagem)
    }

    function limpar() {
      const s = sessao
      if (s?.timer != null) window.clearTimeout(s.timer)
      if (s?.raf != null) cancelAnimationFrame(s.raf)
      if (s?.ativo) {
        document.body.style.userSelect = estiloAnterior.userSelect
        document.body.style.cursor = estiloAnterior.cursor
      }
      window.removeEventListener("pointermove", aoMover)
      window.removeEventListener("pointerup", aoSoltar)
      window.removeEventListener("pointercancel", aoCancelar)
      window.removeEventListener("keydown", aoTecla)
      window.removeEventListener("touchmove", bloquearRolagem)
      sessao = null
      sobreAtual = null
      setArrasto(null)
    }

    function aoMover(evento: PointerEvent) {
      const s = sessao
      if (!s || evento.pointerId !== s.pointerId) return
      s.x = evento.clientX
      s.y = evento.clientY

      if (!s.ativo) {
        const distancia = Math.hypot(s.x - s.x0, s.y - s.y0)
        if (s.tipo === "touch") {
          // Moveu antes do toque longo: é uma rolagem, não um arrasto.
          if (distancia > DISTANCIA_TOQUE) limpar()
        } else if (distancia > DISTANCIA_MOUSE) {
          ativar()
          posicionarFantasma()
        }
        return
      }
      posicionarFantasma()
    }

    function aoSoltar(evento: PointerEvent) {
      const s = sessao
      if (!s || evento.pointerId !== s.pointerId) return
      const estavaArrastando = s.ativo
      const leadId = s.lead.id
      const destino = estavaArrastando ? (colunaSob(evento.clientX, evento.clientY) ?? sobreAtual) : null
      limpar()
      if (!estavaArrastando) return

      // O "click" que o navegador dispara ao soltar não deve abrir o lead.
      acabouDeArrastarRef.current = true
      window.setTimeout(() => {
        acabouDeArrastarRef.current = false
      }, 0)
      if (destino) opcoesRef.current.aoSoltar(leadId, destino)
    }

    function aoCancelar(evento: PointerEvent) {
      if (sessao && evento.pointerId === sessao.pointerId) limpar()
    }

    function aoTecla(evento: KeyboardEvent) {
      if (evento.key === "Escape") limpar()
    }

    // Depois do toque longo a rolagem da página precisa ser travada, senão o
    // dedo arrasta a tela em vez do cartão.
    function bloquearRolagem(evento: TouchEvent) {
      if (sessao?.ativo && evento.cancelable) evento.preventDefault()
    }

    function iniciar(evento: ReactPointerEvent<HTMLElement>, lead: KanbanLead) {
      if (sessao) return
      if (evento.pointerType === "mouse" && evento.button !== 0) return
      if ((evento.target as HTMLElement).closest("[data-sem-arrasto]")) return

      const caixa = evento.currentTarget.getBoundingClientRect()
      const s: Sessao = {
        lead,
        pointerId: evento.pointerId,
        tipo: evento.pointerType,
        x: evento.clientX,
        y: evento.clientY,
        x0: evento.clientX,
        y0: evento.clientY,
        dx: evento.clientX - caixa.left,
        dy: evento.clientY - caixa.top,
        largura: caixa.width,
        ativo: false,
        timer: null,
        raf: null,
      }
      sessao = s

      if (s.tipo === "touch") {
        s.timer = window.setTimeout(() => {
          s.timer = null
          if (sessao === s) {
            ativar()
            posicionarFantasma()
          }
        }, ESPERA_TOQUE_MS)
      }

      window.addEventListener("pointermove", aoMover)
      window.addEventListener("pointerup", aoSoltar)
      window.addEventListener("pointercancel", aoCancelar)
      window.addEventListener("keydown", aoTecla)
      window.addEventListener("touchmove", bloquearRolagem, { passive: false })
    }

    return { iniciar, cancelar: limpar }
  })

  // Se o quadro sair da tela no meio de um arrasto, solta tudo.
  useEffect(() => motor.cancelar, [motor])

  return { arrasto, fantasmaRef, acabouDeArrastarRef, iniciarGesto: motor.iniciar }
}

/* ------------------------------------------------------------------ */
/* Apresentação                                                         */
/* ------------------------------------------------------------------ */

const formatoRelativo = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" })

function tempoRelativo(iso: string) {
  const minutos = Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
  const abs = Math.abs(minutos)
  if (abs < 1) return "agora"
  if (abs < 60) return formatoRelativo.format(minutos, "minute")
  if (abs < 60 * 24) return formatoRelativo.format(Math.round(minutos / 60), "hour")
  if (abs < 60 * 24 * 30) return formatoRelativo.format(Math.round(minutos / 1440), "day")
  return new Date(iso).toLocaleDateString("pt-BR")
}

type CartaoProps = {
  lead: KanbanLead
  arrastando: boolean
  fantasma?: boolean
  onGesto?: (evento: ReactPointerEvent<HTMLElement>, lead: KanbanLead) => void
  onMover?: (leadId: string, destino: LeadStatus) => void
  acabouDeArrastarRef?: RefObject<boolean>
}

const Cartao = memo(function Cartao({ lead, arrastando, fantasma, onGesto, onMover, acabouDeArrastarRef }: CartaoProps) {
  const [primeiraCampanha, ...outras] = lead.campanhasNomes

  return (
    <article
      data-cartao={lead.id}
      onPointerDown={onGesto ? (evento) => onGesto(evento, lead) : undefined}
      onDragStart={(evento) => evento.preventDefault()}
      onContextMenu={(evento) => {
        // O toque longo abre o menu do navegador no celular; aqui ele inicia o arrasto.
        if (window.matchMedia("(pointer: coarse)").matches) evento.preventDefault()
      }}
      className={cn(
        "select-none rounded-lg border bg-card p-3 text-card-foreground shadow-xs [-webkit-touch-callout:none]",
        fantasma
          ? "cursor-grabbing shadow-lg ring-1 ring-primary/40"
          : "cursor-grab transition-colors hover:border-primary/40",
        arrastando && "opacity-40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/leads/${lead.id}`}
          draggable={false}
          data-sem-arrasto
          onClick={(evento) => {
            if (acabouDeArrastarRef?.current) evento.preventDefault()
          }}
          className="min-w-0 truncate text-sm font-medium hover:underline"
          title={lead.nome}
        >
          {lead.nome}
        </Link>

        {onMover ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              data-sem-arrasto
              aria-label={`Mover ${lead.nome} para outra coluna`}
              className="-mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="flex items-center gap-1.5">
                <ArrowRightLeft className="size-3.5" />
                Mover para
              </DropdownMenuLabel>
              {COLUNAS.filter((status) => status !== lead.status).map((status) => (
                <DropdownMenuItem key={status} onClick={() => onMover(lead.id, status)}>
                  <span className={cn("size-2 rounded-full", COR_COLUNA[status].ponto)} aria-hidden />
                  {LEAD_STATUS_LABEL[status]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Phone className="size-3 shrink-0" />
        <span className="truncate">{lead.telefone}</span>
      </p>

      {lead.produto || lead.marca ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {lead.produto ? (
            <Badge variant="secondary" className="max-w-full truncate text-[11px]">
              {lead.produto}
            </Badge>
          ) : null}
          {lead.marca ? (
            <Badge variant="outline" className="max-w-full truncate text-[11px]">
              {lead.marca}
            </Badge>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1">
          {primeiraCampanha ? (
            <>
              <Megaphone className="size-3 shrink-0" />
              <span className="truncate">{primeiraCampanha}</span>
              {outras.length ? <span className="shrink-0">+{outras.length}</span> : null}
            </>
          ) : (
            <span>Sem campanha</span>
          )}
        </span>
        <time dateTime={lead.atualizadoEm} className="shrink-0">
          {tempoRelativo(lead.atualizadoEm)}
        </time>
      </div>
    </article>
  )
})

type FantasmaProps = { estado: EstadoArrasto; fantasmaRef: RefObject<HTMLDivElement | null> }

/** Cópia do cartão que acompanha o ponteiro. Fica fora da árvore do quadro (portal). */
const Fantasma = memo(function Fantasma({ estado, fantasmaRef }: FantasmaProps) {
  useLayoutEffect(() => {
    const el = fantasmaRef.current
    if (el) el.style.transform = `translate3d(${estado.x - estado.dx}px, ${estado.y - estado.dy}px, 0) rotate(2deg)`
  }, [estado.x, estado.y, estado.dx, estado.dy, fantasmaRef])

  return createPortal(
    <div
      ref={fantasmaRef}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-50 will-change-transform"
      style={{ width: estado.largura }}
    >
      <Cartao lead={estado.lead} arrastando={false} fantasma />
    </div>,
    document.body,
  )
})

type ColunaProps = {
  status: LeadStatus
  leads: KanbanLead[]
  total: number
  limite: number
  filtrando: boolean
  arrastandoId: string | null
  destacada: boolean
  onGesto: CartaoProps["onGesto"]
  onMover: (leadId: string, destino: LeadStatus) => void
  acabouDeArrastarRef: RefObject<boolean>
}

const Coluna = memo(function Coluna({
  status,
  leads,
  total,
  limite,
  filtrando,
  arrastandoId,
  destacada,
  onGesto,
  onMover,
  acabouDeArrastarRef,
}: ColunaProps) {
  const cor = COR_COLUNA[status]
  const naoExibidos = Math.max(0, total - Math.min(total, limite))

  return (
    <section
      data-coluna={status}
      aria-label={`Coluna ${LEAD_STATUS_LABEL[status]}`}
      className={cn(
        "flex min-h-0 w-[82vw] max-w-[320px] shrink-0 snap-start flex-col rounded-xl border border-t-4 bg-muted/40 transition-colors md:w-[300px] lg:w-auto lg:max-w-none lg:min-w-[250px] lg:flex-1",
        cor.topo,
        destacada && "border-primary/50 bg-primary/10 ring-2 ring-primary/40",
      )}
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className={cn("size-2 rounded-full", cor.ponto)} aria-hidden />
          {LEAD_STATUS_LABEL[status]}
        </h2>
        <span className="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {filtrando ? `${leads.length} de ${total}` : total}
        </span>
      </header>

      <div data-coluna-corpo className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-2 pb-2">
        {leads.length ? (
          leads.map((lead) => (
            <Cartao
              key={lead.id}
              lead={lead}
              arrastando={arrastandoId === lead.id}
              onGesto={onGesto}
              onMover={onMover}
              acabouDeArrastarRef={acabouDeArrastarRef}
            />
          ))
        ) : (
          <div
            className={cn(
              "flex flex-1 items-center justify-center rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground",
              destacada && "border-primary/50 text-primary",
            )}
          >
            {destacada ? "Solte aqui" : filtrando ? "Nenhum lead encontrado" : "Nenhum lead"}
          </div>
        )}

        {!filtrando && naoExibidos > 0 ? (
          <p className="px-1 py-2 text-center text-[11px] text-muted-foreground">
            Mostrando {limite} de {total}. Veja os demais na aba Leads.
          </p>
        ) : null}
      </div>
    </section>
  )
})

/* ------------------------------------------------------------------ */
/* Quadro                                                               */
/* ------------------------------------------------------------------ */

export function KanbanBoard({ inicial }: { inicial: KanbanBoardData }) {
  const router = useRouter()
  const [leads, setLeads] = useState(inicial.leads)
  const [totais, setTotais] = useState(inicial.totais)
  const [versaoInicial, setVersaoInicial] = useState(inicial)
  const [busca, setBusca] = useState("")
  // Arrastar para "Em campanha" não move direto: antes pergunta a campanha.
  const [pedidoCampanha, setPedidoCampanha] = useState<{ leadId: string; nome: string } | null>(null)
  // Marcar como "Respondeu" pergunta o que o lead respondeu (mesmo modal da aba Leads).
  const [pedidoResposta, setPedidoResposta] = useState<{ leadId: string; nome: string } | null>(null)
  const [campanhaEscolhida, setCampanhaEscolhida] = useState("")
  const [mensagemIndividual, setMensagemIndividual] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const leadsRef = useRef(leads)

  // Quando o servidor entrega dados novos (ex.: ao voltar para a aba), eles viram a verdade.
  if (inicial !== versaoInicial) {
    setVersaoInicial(inicial)
    setLeads(inicial.leads)
    setTotais(inicial.totais)
  }

  useEffect(() => {
    leadsRef.current = leads
  }, [leads])

  const campanhas = inicial.campanhas
  const campanhasRef = useRef(campanhas)
  useEffect(() => {
    campanhasRef.current = campanhas
  })

  const mover = useCallback((leadId: string, destino: LeadStatus, extras: { campanha?: { id: string; nome: string; mensagem?: string }; resposta?: string } = {}) => {
    const { campanha, resposta } = extras
    const lead = leadsRef.current.find((item) => item.id === leadId)
    if (!lead || lead.status === destino) return

    const origem = lead.status
    // Responder tira o lead de todas as campanhas (regra do `setLeadStatus`).
    const atualizado: KanbanLead = {
      ...lead,
      status: destino,
      atualizadoEm: new Date().toISOString(),
      campanhasNomes:
        destino === "respondeu"
          ? []
          : destino === "em_campanha" && campanha
            ? [...new Set([...lead.campanhasNomes, campanha.nome])]
            : lead.campanhasNomes,
    }

    const trocar = (por: KanbanLead) => (atual: KanbanLead[]) => atual.map((item) => (item.id === leadId ? por : item))
    setLeads(trocar(atualizado))
    setTotais((atual) => ({
      ...atual,
      [origem]: Math.max(0, atual[origem] - 1),
      [destino]: atual[destino] + 1,
    }))

    void moveKanbanLeadAction(leadId, destino, { campanhaId: campanha?.id, mensagemIndividual: campanha?.mensagem, resposta })
      .then((resultado) => {
        if (!resultado.ok) throw new Error(resultado.message)
        toast.success(
          destino === "em_campanha" && campanha
            ? `${lead.nome} → ${campanha.nome}`
            : destino === "respondeu"
              ? `${lead.nome} marcado como respondido e removido da campanha.`
              : `${lead.nome} → ${LEAD_STATUS_LABEL[destino]}`,
        )
      })
      .catch((erro: unknown) => {
        setLeads(trocar(lead))
        setTotais((atual) => ({
          ...atual,
          [origem]: atual[origem] + 1,
          [destino]: Math.max(0, atual[destino] - 1),
        }))
        toast.error(erro instanceof Error ? erro.message : "Não foi possível mover o lead.")
      })
  }, [])

  // Ponto único de entrada para arrasto e menu "Mover para".
  const pedirMover = useCallback(
    (leadId: string, destino: LeadStatus) => {
      const lead = leadsRef.current.find((item) => item.id === leadId)
      if (!lead || lead.status === destino) return

      if (destino === "em_campanha") {
        if (campanhasRef.current.length === 0) {
          toast.error("Não há campanha disponível. Crie uma campanha antes de mover o lead.")
          return
        }
        setCampanhaEscolhida("")
        setMensagemIndividual("")
        setPedidoCampanha({ leadId, nome: lead.nome })
        return
      }
      if (destino === "respondeu") {
        setPedidoResposta({ leadId, nome: lead.nome })
        return
      }
      mover(leadId, destino)
    },
    [mover],
  )

  const { arrasto, fantasmaRef, acabouDeArrastarRef, iniciarGesto } = useArrastoDeCards(scrollRef, { aoSoltar: pedirMover })

  const opcoesCampanha: OpcaoSelect[] = useMemo(
    () =>
      campanhas.map((campanha) => ({
        value: campanha.id,
        label: `${campanha.nome} · ${CAMPAIGN_STATUS_LABEL[campanha.status].toLowerCase()}`,
      })),
    [campanhas],
  )
  const campanhaSelecionada = campanhas.find((campanha) => campanha.id === campanhaEscolhida) ?? null
  const exigeMensagem = campanhaSelecionada?.tipo === "individual"
  const podeConfirmar = Boolean(campanhaSelecionada) && (!exigeMensagem || mensagemIndividual.trim().length >= 10)

  function confirmarCampanha() {
    if (!pedidoCampanha || !campanhaSelecionada || !podeConfirmar) return
    const { leadId } = pedidoCampanha
    setPedidoCampanha(null)
    mover(leadId, "em_campanha", {
      campanha: {
        id: campanhaSelecionada.id,
        nome: campanhaSelecionada.nome,
        mensagem: exigeMensagem ? mensagemIndividual.trim() : undefined,
      },
    })
  }

  function confirmarResposta(resposta: string | undefined) {
    if (!pedidoResposta) return
    const { leadId } = pedidoResposta
    setPedidoResposta(null)
    mover(leadId, "respondeu", { resposta })
  }

  // Atualiza discretamente ao voltar para a aba, sem interferir em um arrasto em andamento.
  const arrastandoRef = useRef(false)
  useEffect(() => {
    arrastandoRef.current = arrasto !== null
  }, [arrasto])
  useEffect(() => {
    function aoVoltar() {
      if (document.visibilityState === "visible" && !arrastandoRef.current) router.refresh()
    }
    document.addEventListener("visibilitychange", aoVoltar)
    return () => document.removeEventListener("visibilitychange", aoVoltar)
  }, [router])

  const termo = busca.trim().toLowerCase()
  const colunas = useMemo(() => {
    const agrupado = Object.fromEntries(COLUNAS.map((status) => [status, [] as KanbanLead[]])) as Record<
      LeadStatus,
      KanbanLead[]
    >
    for (const lead of leads) {
      if (termo && !`${lead.nome} ${lead.telefone} ${lead.produto} ${lead.marca}`.toLowerCase().includes(termo)) continue
      agrupado[lead.status].push(lead)
    }
    for (const status of COLUNAS) {
      agrupado[status].sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm))
    }
    return agrupado
  }, [leads, termo])

  return (
    <div className="flex h-[calc(100dvh-5.5rem)] min-h-[420px] flex-col md:h-[calc(100dvh-6.5rem)]">
      <PageHeader
        titulo="Kanban"
        descricao="Os leads organizados pelo status. Arraste um cartão para outra coluna para mudar o status."
      >
        <div className="relative w-full md:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Buscar lead"
            aria-label="Buscar leads no quadro"
            className="pl-8 pr-8"
          />
          {busca ? (
            <button
              type="button"
              onClick={() => setBusca("")}
              aria-label="Limpar busca"
              className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </PageHeader>

      <div
        ref={scrollRef}
        className={cn(
          "-mx-4 flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6",
          !arrasto && "snap-x snap-mandatory md:snap-none",
        )}
      >
        {COLUNAS.map((status) => (
          <Coluna
            key={status}
            status={status}
            leads={colunas[status]}
            total={totais[status]}
            limite={inicial.limitePorColuna}
            filtrando={termo.length > 0}
            arrastandoId={arrasto?.lead.id ?? null}
            destacada={arrasto !== null && arrasto.sobre === status && arrasto.lead.status !== status}
            onGesto={iniciarGesto}
            onMover={pedirMover}
            acabouDeArrastarRef={acabouDeArrastarRef}
          />
        ))}
      </div>

      {arrasto ? <Fantasma estado={arrasto} fantasmaRef={fantasmaRef} /> : null}

      <LeadRespostaDialog
        leadNome={pedidoResposta?.nome ?? null}
        onConfirmar={confirmarResposta}
        onCancelar={() => setPedidoResposta(null)}
      />

      <Dialog open={pedidoCampanha !== null} onOpenChange={(aberto) => !aberto && setPedidoCampanha(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Em qual campanha {pedidoCampanha?.nome} vai entrar?</DialogTitle>
            <DialogDescription>
              Escolha a campanha para mover o lead para Em campanha. Se você cancelar, o lead continua onde está.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <label htmlFor="kanban-campanha" className="text-sm font-medium">
              Campanha
            </label>
            <SelectField
              id="kanban-campanha"
              value={campanhaEscolhida}
              onValueChange={setCampanhaEscolhida}
              opcoes={opcoesCampanha}
              placeholder="Selecione uma campanha"
              className="w-full"
            />
          </div>

          {exigeMensagem ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="kanban-mensagem" className="text-sm font-medium">
                Mensagem individual
              </label>
              <p className="text-xs text-muted-foreground">
                Campanha individual: o lead só recebe algo quando há uma mensagem própria vinculada a ele.
              </p>
              <Textarea
                id="kanban-mensagem"
                value={mensagemIndividual}
                onChange={(evento) => setMensagemIndividual(evento.target.value)}
                placeholder="Escreva a mensagem que será enviada a este lead…"
                className="min-h-28 resize-y"
                maxLength={4096}
              />
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPedidoCampanha(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmarCampanha} disabled={!podeConfirmar}>
              Mover para a campanha
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
