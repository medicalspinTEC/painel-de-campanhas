"use client"

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent, type RefObject } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Info, MoreHorizontal, Phone, RotateCw, Search, Send, X } from "lucide-react"

import { avancarEtapaCampanhaKanbanAction } from "@/app/actions/kanban"
import { KanbanModoToggle } from "@/components/features/kanban/kanban-modo-toggle"
import { useArrastoDeCards, type EstadoArrasto } from "@/components/features/kanban/use-arrasto-de-cards"
import { LinkButton } from "@/components/shared/link-button"
import { PageHeader } from "@/components/shared/page-header"
import { CampaignStatusBadge } from "@/components/shared/status-badges"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { formatarTempoAte } from "@/lib/next-message"
import { cn } from "@/lib/utils"
import type { KanbanCampanha, KanbanCampanhaBoardData, KanbanCampanhaLead, KanbanEtapa } from "@/services/kanban"

/** Cores das colunas: a primeira é neutra, a última (concluída) é verde e as do meio alternam. */
const CORES_MEIO = [
  { ponto: "bg-chart-1", topo: "border-t-chart-1" },
  { ponto: "bg-chart-2", topo: "border-t-chart-2" },
  { ponto: "bg-chart-4", topo: "border-t-chart-4" },
]
const COR_INICIO = { ponto: "bg-muted-foreground", topo: "border-t-muted-foreground/60" }
const COR_FIM = { ponto: "bg-chart-3", topo: "border-t-chart-3" }

function corDaEtapa(indice: number, ultimo: number, individual: boolean) {
  if (indice === 0) return COR_INICIO
  if (indice === ultimo) return COR_FIM
  return individual ? COR_FIM : CORES_MEIO[(indice - 1) % CORES_MEIO.length]
}

/**
 * Etapa para a qual o cartão pode ir: a seguinte (que envia a próxima mensagem agora). Com a sequência
 * concluída, o "próximo passo" é reiniciar o ciclo, que envia a 1ª mensagem — ou seja, a etapa 1.
 */
function etapaAlvo(etapa: number, totalMensagens: number) {
  return etapa >= totalMensagens ? 1 : etapa + 1
}

type Pedido = { lead: KanbanCampanhaLead; destino: number }

/* ------------------------------------------------------------------ */
/* Cartão                                                               */
/* ------------------------------------------------------------------ */

type CartaoProps = {
  lead: KanbanCampanhaLead
  agora: number
  arrastando: boolean
  enviando: boolean
  fantasma?: boolean
  totalMensagens: number
  onGesto?: (evento: ReactPointerEvent<HTMLElement>, lead: KanbanCampanhaLead) => void
  onAvancar?: (lead: KanbanCampanhaLead) => void
  acabouDeArrastarRef?: RefObject<boolean>
}

const Cartao = memo(function Cartao({
  lead,
  agora,
  arrastando,
  enviando,
  fantasma,
  totalMensagens,
  onGesto,
  onAvancar,
  acabouDeArrastarRef,
}: CartaoProps) {
  const reinicia = lead.etapa >= totalMensagens
  const proxima = lead.proximaMensagemEm ? formatarTempoAte(new Date(lead.proximaMensagemEm), new Date(agora)) : "—"

  return (
    <article
      data-cartao={lead.id}
      onPointerDown={onGesto && !enviando ? (evento) => onGesto(evento, lead) : undefined}
      onDragStart={(evento) => evento.preventDefault()}
      onContextMenu={(evento) => {
        // O toque longo abre o menu do navegador no celular; aqui ele inicia o arrasto.
        if (window.matchMedia("(pointer: coarse)").matches) evento.preventDefault()
      }}
      aria-busy={enviando}
      className={cn(
        "select-none rounded-lg border bg-card p-3 text-card-foreground shadow-xs [-webkit-touch-callout:none]",
        fantasma
          ? "cursor-grabbing shadow-lg ring-1 ring-primary/40"
          : onGesto
            ? "cursor-grab transition-colors hover:border-primary/40"
            : "transition-colors",
        (arrastando || enviando) && "opacity-40",
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

        {enviando ? (
          <Spinner className="size-4 shrink-0" />
        ) : onAvancar ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              data-sem-arrasto
              aria-label={`Ações de ${lead.nome} na campanha`}
              className="-mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onAvancar(lead)}>
                {reinicia ? <RotateCw className="size-4" aria-hidden /> : <Send className="size-4" aria-hidden />}
                {reinicia ? "Reiniciar ciclo e enviar a 1ª mensagem" : `Enviar a mensagem ${lead.etapa + 1} agora`}
              </DropdownMenuItem>
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

      {totalMensagens > 0 ? (
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>Próxima mensagem</span>
          <span className="flex items-center gap-1.5">
            {lead.aguardandoRecorrencia ? (
              <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px] font-normal">
                <RotateCw className="size-2.5" aria-hidden />
                recorrência
              </Badge>
            ) : null}
            <span className="tabular-nums">{proxima}</span>
          </span>
        </div>
      ) : null}
    </article>
  )
})

const Fantasma = memo(function Fantasma({
  estado,
  fantasmaRef,
  agora,
  totalMensagens,
}: {
  estado: EstadoArrasto<KanbanCampanhaLead, string>
  fantasmaRef: RefObject<HTMLDivElement | null>
  agora: number
  totalMensagens: number
}) {
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
      <Cartao lead={estado.lead} agora={agora} arrastando={false} enviando={false} fantasma totalMensagens={totalMensagens} />
    </div>,
    document.body,
  )
})

/* ------------------------------------------------------------------ */
/* Coluna                                                               */
/* ------------------------------------------------------------------ */

type ColunaProps = {
  etapa: KanbanEtapa
  cor: { ponto: string; topo: string }
  leads: KanbanCampanhaLead[]
  total: number
  limite: number
  filtrando: boolean
  agora: number
  totalMensagens: number
  arrastandoId: string | null
  enviandoId: string | null
  /** Coluna que receberia o cartão arrastado (próxima etapa válida). */
  ehAlvo: boolean
  /** O ponteiro está sobre esta coluna durante o arrasto. */
  sobre: boolean
  onGesto?: CartaoProps["onGesto"]
  onAvancar?: CartaoProps["onAvancar"]
  acabouDeArrastarRef: RefObject<boolean>
}

const Coluna = memo(function Coluna({
  etapa,
  cor,
  leads,
  total,
  limite,
  filtrando,
  agora,
  totalMensagens,
  arrastandoId,
  enviandoId,
  ehAlvo,
  sobre,
  onGesto,
  onAvancar,
  acabouDeArrastarRef,
}: ColunaProps) {
  const naoExibidos = Math.max(0, total - Math.min(total, limite))
  const destacada = ehAlvo && sobre

  return (
    <section
      data-coluna={String(etapa.indice)}
      aria-label={`Etapa ${etapa.titulo}`}
      className={cn(
        "flex min-h-0 w-[82vw] max-w-[320px] shrink-0 snap-start flex-col rounded-xl border border-t-4 bg-muted/40 transition-colors md:w-[300px] lg:w-auto lg:max-w-none lg:min-w-[250px] lg:flex-1",
        cor.topo,
        ehAlvo && !sobre && "border-primary/30 bg-primary/5",
        destacada && "border-primary/50 bg-primary/10 ring-2 ring-primary/40",
      )}
    >
      <header className="flex items-start justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <span className={cn("size-2 shrink-0 rounded-full", cor.ponto)} aria-hidden />
            <span className="truncate">{etapa.titulo}</span>
          </h2>
          <p className="mt-0.5 truncate pl-4 text-[11px] text-muted-foreground" title={etapa.subtitulo}>
            {etapa.subtitulo}
          </p>
        </div>
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
              agora={agora}
              arrastando={arrastandoId === lead.id}
              enviando={enviandoId === lead.id}
              totalMensagens={totalMensagens}
              onGesto={onGesto}
              onAvancar={onAvancar}
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
            {destacada ? "Solte para enviar" : filtrando ? "Nenhum lead encontrado" : "Nenhum lead"}
          </div>
        )}

        {!filtrando && naoExibidos > 0 ? (
          <p className="px-1 py-2 text-center text-[11px] text-muted-foreground">
            Mostrando {limite} de {total}. Use a busca para encontrar os demais.
          </p>
        ) : null}
      </div>
    </section>
  )
})

/* ------------------------------------------------------------------ */
/* Quadro                                                               */
/* ------------------------------------------------------------------ */

export function KanbanCampanhaBoard({
  inicial,
  campanhas,
}: {
  inicial: KanbanCampanhaBoardData
  /** Campanhas do seletor de modo (a campanha aberta sempre está na lista). */
  campanhas: KanbanCampanha[]
}) {
  const router = useRouter()
  const { campanha, etapas, podeAvancar, limitePorColuna } = inicial
  const totalMensagens = campanha.totalMensagens
  const individual = campanha.tipo === "individual"
  const ultimo = etapas.length - 1

  const [leads, setLeads] = useState(inicial.leads)
  const [versaoInicial, setVersaoInicial] = useState(inicial)
  const [busca, setBusca] = useState("")
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [enviandoId, setEnviandoId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // Relógio que atualiza a contagem regressiva dos cartões a cada 30 s.
  const [agora, setAgora] = useState(() => Date.now())
  const scrollRef = useRef<HTMLDivElement>(null)
  const leadsRef = useRef(leads)

  // Quando o servidor entrega dados novos (ex.: ao voltar para a aba), eles viram a verdade.
  if (inicial !== versaoInicial) {
    setVersaoInicial(inicial)
    setLeads(inicial.leads)
  }

  useEffect(() => {
    leadsRef.current = leads
  }, [leads])

  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const nomeEtapa = useCallback((indice: number) => etapas[indice]?.titulo ?? "", [etapas])

  // Ponto único de entrada para o arrasto e para o menu do cartão: sempre pede confirmação,
  // porque mover o cartão envia uma mensagem de verdade para o WhatsApp do lead.
  const pedirAvancar = useCallback(
    (leadId: string, destino: number) => {
      if (!podeAvancar) return
      const lead = leadsRef.current.find((item) => item.id === leadId)
      if (!lead || lead.etapa === destino) return

      const alvo = etapaAlvo(lead.etapa, totalMensagens)
      if (destino !== alvo) {
        toast.info(
          destino < lead.etapa
            ? "As mensagens já enviadas não podem ser desfeitas. Mova o lead apenas para a próxima etapa."
            : `Avance uma etapa por vez: mova ${lead.nome} para “${nomeEtapa(alvo)}” para enviar a próxima mensagem.`,
        )
        return
      }
      setPedido({ lead, destino })
    },
    [podeAvancar, totalMensagens, nomeEtapa],
  )

  const aoSoltar = useCallback((leadId: string, destino: string) => pedirAvancar(leadId, Number(destino)), [pedirAvancar])

  const avancarPeloMenu = useCallback(
    (lead: KanbanCampanhaLead) => setPedido({ lead, destino: etapaAlvo(lead.etapa, totalMensagens) }),
    [totalMensagens],
  )

  const { arrasto, fantasmaRef, acabouDeArrastarRef, iniciarGesto } = useArrastoDeCards<KanbanCampanhaLead, string>(scrollRef, {
    aoSoltar,
    colunaValida: (valor) => /^\d+$/.test(valor) && Number(valor) <= ultimo,
  })

  function confirmarAvanco() {
    if (!pedido) return
    const { lead, destino } = pedido
    setEnviandoId(lead.id)
    startTransition(async () => {
      const res = await avancarEtapaCampanhaKanbanAction(lead.id, campanha.id)
      if (res.ok) {
        setLeads((atual) =>
          atual.map((item) =>
            item.id === lead.id
              ? {
                  ...item,
                  etapa: destino,
                  proximaMensagemEm: res.proximaMensagemEm ?? null,
                  aguardandoRecorrencia: Boolean(res.aguardandoRecorrencia),
                }
              : item,
          ),
        )
        toast.success(`${lead.nome}: ${res.message}`)
      } else {
        toast.error(`${lead.nome}: ${res.message}`)
      }
      setEnviandoId(null)
      setPedido(null)
    })
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
  const { porEtapa, totais } = useMemo(() => {
    const agrupado: KanbanCampanhaLead[][] = etapas.map(() => [])
    const contagem: number[] = etapas.map(() => 0)
    for (const lead of leads) {
      const indice = Math.min(Math.max(lead.etapa, 0), ultimo)
      contagem[indice] += 1
      if (termo && !`${lead.nome} ${lead.telefone} ${lead.produto} ${lead.marca}`.toLowerCase().includes(termo)) continue
      agrupado[indice].push(lead)
    }
    // Quem vai receber primeiro aparece no topo; sem horário previsto vai para o fim.
    const chave = (lead: KanbanCampanhaLead) => lead.proximaMensagemEm ?? "9999"
    for (const coluna of agrupado) coluna.sort((a, b) => chave(a).localeCompare(chave(b)) || a.nome.localeCompare(b.nome, "pt-BR"))
    return { porEtapa: agrupado, totais: contagem }
  }, [leads, etapas, ultimo, termo])

  const alvoDoArrasto = arrasto ? etapaAlvo(arrasto.lead.etapa, totalMensagens) : null
  const modoToggle = <KanbanModoToggle campanhas={campanhas} campanhaAtualId={campanha.id} />

  return (
    <div className="flex h-[calc(100dvh-5.5rem)] min-h-[420px] flex-col md:h-[calc(100dvh-6.5rem)]">
      <PageHeader
        titulo="Kanban"
        descricao={
          podeAvancar
            ? `Etapas da campanha ${campanha.nome}. Arraste um lead para a próxima etapa para enviar a mensagem agora (o mesmo que “Pular”).`
            : `Etapas da campanha ${campanha.nome}.`
        }
      >
        {modoToggle}
        <div className="relative w-full md:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Buscar lead"
            aria-label="Buscar leads no quadro da campanha"
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
        <LinkButton variant="outline" href={`/campanhas/${campanha.id}`}>
          Ver campanha
        </LinkButton>
      </PageHeader>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <CampaignStatusBadge status={campanha.status} />
        <span>
          {leads.length} {leads.length === 1 ? "lead" : "leads"} na campanha
        </span>
        {!podeAvancar ? (
          <span className="flex items-center gap-1.5">
            <Info className="size-3.5 shrink-0" aria-hidden />
            {individual
              ? "Campanha individual: cada lead recebe uma única mensagem própria, então aqui você só acompanha o envio."
              : "Esta campanha ainda não tem mensagens na sequência."}
          </span>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        className={cn(
          "-mx-4 flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6",
          !arrasto && "snap-x snap-mandatory md:snap-none",
        )}
      >
        {etapas.map((etapa) => (
          <Coluna
            key={etapa.indice}
            etapa={etapa}
            cor={corDaEtapa(etapa.indice, ultimo, individual)}
            leads={porEtapa[etapa.indice]}
            total={totais[etapa.indice]}
            limite={limitePorColuna}
            filtrando={termo.length > 0}
            agora={agora}
            totalMensagens={totalMensagens}
            arrastandoId={arrasto?.lead.id ?? null}
            enviandoId={enviandoId}
            ehAlvo={alvoDoArrasto === etapa.indice && arrasto?.lead.etapa !== etapa.indice}
            sobre={arrasto?.sobre === String(etapa.indice)}
            onGesto={podeAvancar ? iniciarGesto : undefined}
            onAvancar={podeAvancar ? avancarPeloMenu : undefined}
            acabouDeArrastarRef={acabouDeArrastarRef}
          />
        ))}
      </div>

      {arrasto ? <Fantasma estado={arrasto} fantasmaRef={fantasmaRef} agora={agora} totalMensagens={totalMensagens} /> : null}

      <AlertDialog open={pedido !== null} onOpenChange={(aberto) => !aberto && !pending && setPedido(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar a próxima mensagem agora?</AlertDialogTitle>
            <AlertDialogDescription>
              {pedido && pedido.lead.etapa >= totalMensagens
                ? `${pedido.lead.nome} já recebeu toda a sequência. O ciclo será reiniciado e a primeira mensagem enviada agora.`
                : `A mensagem ${(pedido?.lead.etapa ?? 0) + 1} da sequência será enviada agora para ${pedido?.lead.nome} e o contador será reiniciado. O lead vai para “${nomeEtapa(pedido?.destino ?? 0)}”.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarAvanco} disabled={pending}>
              {pending ? "Enviando…" : "Enviar agora"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
