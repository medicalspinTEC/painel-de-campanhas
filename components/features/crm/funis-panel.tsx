"use client"

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent, type RefObject } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { Filter, MoreHorizontal, Pencil, Phone, Plus, Search, Settings2, Trash2, UserPlus, X } from "lucide-react"
import { toast } from "sonner"

import {
  carregarFunilAction,
  definirValorFunilAction,
  excluirFunilAction,
  moverLeadNoFunilAction,
  removerLeadDoFunilAction,
} from "@/app/actions/funis"
import { FunilAdicionarLeadDialog } from "@/components/features/crm/funil-adicionar-lead-dialog"
import { FunilEtapasDialog } from "@/components/features/crm/funil-etapas-dialog"
import { FunilFormDialog } from "@/components/features/crm/funil-form-dialog"
import { useArrastoDeCards, type EstadoArrasto } from "@/components/features/kanban/use-arrasto-de-cards"
import { SelectField } from "@/components/shared/select-field"
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
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  FUNIL_COR_ESTILOS,
  FUNIL_TIPO_ROTULO,
  formatarValorFunil,
  lerValorFunil,
  type FunilBoardData,
  type FunilCartao,
  type FunilEtapaItem,
  type FunilResumo,
} from "@/lib/funis"
import { cn } from "@/lib/utils"

const BORDA_TOPO: Record<string, string> = {
  cinza: "border-t-zinc-500",
  vermelho: "border-t-red-500",
  laranja: "border-t-orange-500",
  amarelo: "border-t-yellow-500",
  verde: "border-t-green-500",
  azul: "border-t-blue-500",
  roxo: "border-t-purple-500",
  rosa: "border-t-pink-500",
}

/* ------------------------------------------------------------------ */
/* Cartão                                                               */
/* ------------------------------------------------------------------ */

type CartaoProps = {
  lead: FunilCartao
  etapas: FunilEtapaItem[]
  arrastando: boolean
  ocupado: boolean
  fantasma?: boolean
  inativo: boolean
  onGesto?: (evento: ReactPointerEvent<HTMLElement>, lead: FunilCartao) => void
  onMover?: (lead: FunilCartao, etapaId: string) => void
  onValor?: (lead: FunilCartao) => void
  onRemover?: (lead: FunilCartao) => void
  acabouDeArrastarRef?: RefObject<boolean>
}

const Cartao = memo(function Cartao({ lead, etapas, arrastando, ocupado, fantasma, inativo, onGesto, onMover, onValor, onRemover, acabouDeArrastarRef }: CartaoProps) {
  return (
    <article
      data-cartao={lead.id}
      onPointerDown={onGesto && !ocupado && !inativo ? (evento) => onGesto(evento, lead) : undefined}
      onDragStart={(evento) => evento.preventDefault()}
      onContextMenu={(evento) => {
        // O toque longo abre o menu do navegador no celular; aqui ele inicia o arrasto.
        if (window.matchMedia("(pointer: coarse)").matches) evento.preventDefault()
      }}
      aria-busy={ocupado}
      className={cn(
        "select-none rounded-lg border bg-card p-3 text-card-foreground shadow-xs [-webkit-touch-callout:none]",
        fantasma ? "cursor-grabbing shadow-lg ring-1 ring-primary/40" : onGesto && !inativo ? "cursor-grab transition-colors hover:border-primary/40" : "transition-colors",
        (arrastando || ocupado) && "opacity-40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/leads/${lead.leadId}`}
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

        {ocupado ? (
          <Spinner className="size-4 shrink-0" />
        ) : onMover && !inativo ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              data-sem-arrasto
              aria-label={`Ações de ${lead.nome} no funil`}
              className="-mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Mover para</DropdownMenuLabel>
              {etapas
                .filter((etapa) => etapa.id !== lead.etapaId)
                .map((etapa) => (
                  <DropdownMenuItem key={etapa.id} onClick={() => onMover(lead, etapa.id)}>
                    <span className={cn("size-2 rounded-full", FUNIL_COR_ESTILOS[etapa.cor].ponto)} aria-hidden />
                    {etapa.nome}
                  </DropdownMenuItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onValor?.(lead)}>
                <Pencil className="size-4" aria-hidden />
                {lead.valor === null ? "Definir valor" : "Alterar valor"}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => onRemover?.(lead)}>
                <Trash2 className="size-4" aria-hidden />
                Remover do funil
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

      {lead.valor !== null ? <p className="mt-2 text-sm font-semibold tabular-nums">{formatarValorFunil(lead.valor)}</p> : null}
    </article>
  )
})

const Fantasma = memo(function Fantasma({
  estado,
  fantasmaRef,
  etapas,
}: {
  estado: EstadoArrasto<FunilCartao, string>
  fantasmaRef: RefObject<HTMLDivElement | null>
  etapas: FunilEtapaItem[]
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
      <Cartao lead={estado.lead} etapas={etapas} arrastando={false} ocupado={false} inativo={false} fantasma />
    </div>,
    document.body,
  )
})

/* ------------------------------------------------------------------ */
/* Coluna                                                               */
/* ------------------------------------------------------------------ */

const Coluna = memo(function Coluna({
  etapa,
  leads,
  total,
  valor,
  limite,
  filtrando,
  etapas,
  arrastandoId,
  ocupadoId,
  inativo,
  sobre,
  onGesto,
  onMover,
  onValor,
  onRemover,
  acabouDeArrastarRef,
}: {
  etapa: FunilEtapaItem
  leads: FunilCartao[]
  total: number
  valor: number
  limite: number
  filtrando: boolean
  etapas: FunilEtapaItem[]
  arrastandoId: string | null
  ocupadoId: string | null
  inativo: boolean
  sobre: boolean
  onGesto?: CartaoProps["onGesto"]
  onMover?: CartaoProps["onMover"]
  onValor?: CartaoProps["onValor"]
  onRemover?: CartaoProps["onRemover"]
  acabouDeArrastarRef: RefObject<boolean>
}) {
  const naoExibidos = Math.max(0, total - limite)
  return (
    <section
      data-coluna={etapa.id}
      aria-label={`Etapa ${etapa.nome}`}
      className={cn(
        "flex min-h-0 w-[82vw] max-w-[320px] shrink-0 snap-start flex-col rounded-xl border border-t-4 bg-muted/40 transition-colors md:w-[300px] lg:w-auto lg:max-w-none lg:min-w-[250px] lg:flex-1",
        BORDA_TOPO[etapa.cor] ?? BORDA_TOPO.azul,
        sobre && "border-primary/50 bg-primary/10 ring-2 ring-primary/40",
      )}
    >
      <header className="flex items-start justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <span className={cn("size-2 shrink-0 rounded-full", FUNIL_COR_ESTILOS[etapa.cor].ponto)} aria-hidden />
            <span className="truncate">{etapa.nome}</span>
          </h2>
          <p className="mt-0.5 truncate pl-4 text-[11px] text-muted-foreground">
            {etapa.tipo === "aberta" ? "" : `${FUNIL_TIPO_ROTULO[etapa.tipo]} · `}
            {formatarValorFunil(valor)}
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
              etapas={etapas}
              arrastando={arrastandoId === lead.id}
              ocupado={ocupadoId === lead.id}
              inativo={inativo}
              onGesto={onGesto}
              onMover={onMover}
              onValor={onValor}
              onRemover={onRemover}
              acabouDeArrastarRef={acabouDeArrastarRef}
            />
          ))
        ) : (
          <div
            className={cn(
              "flex flex-1 items-center justify-center rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground",
              sobre && "border-primary/50 text-primary",
            )}
          >
            {sobre ? "Solte para mover" : filtrando ? "Nenhum lead encontrado" : "Nenhum lead"}
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
/* Painel                                                               */
/* ------------------------------------------------------------------ */

export function FunisPanel({ funis, boardInicial }: { funis: FunilResumo[]; boardInicial: FunilBoardData | null }) {
  const [funilId, setFunilId] = useState<string | null>(boardInicial?.funil.id ?? funis[0]?.id ?? null)
  const [board, setBoard] = useState<FunilBoardData | null>(boardInicial)
  const [carregando, setCarregando] = useState(false)
  const [busca, setBusca] = useState("")
  const [ocupadoId, setOcupadoId] = useState<string | null>(null)
  const [formAberto, setFormAberto] = useState(false)
  const [editandoFunil, setEditandoFunil] = useState(false)
  const [etapasAberto, setEtapasAberto] = useState(false)
  const [adicionarAberto, setAdicionarAberto] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [removendo, setRemovendo] = useState<FunilCartao | null>(null)
  const [editandoValor, setEditandoValor] = useState<FunilCartao | null>(null)
  const [valorTexto, setValorTexto] = useState("")
  const [pending, startTransition] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef(board)
  useEffect(() => {
    boardRef.current = board
  }, [board])

  const carregar = useCallback(async (id: string) => {
    setCarregando(true)
    const res = await carregarFunilAction(id)
    setCarregando(false)
    if (res.ok && res.board) {
      setBoard(res.board)
      setFunilId(id)
    } else {
      toast.error(res.message)
    }
  }, [])

  function selecionar(id: string) {
    if (id === funilId) return
    setBusca("")
    setFunilId(id)
    void carregar(id)
  }

  /** Move o cartão no quadro (otimista) e desfaz se o servidor recusar. */
  const moverCartao = useCallback((leadId: string, etapaId: string) => {
    const atual = boardRef.current
    if (!atual || !atual.funil.ativo) return
    const lead = atual.leads.find((item) => item.leadId === leadId)
    if (!lead || lead.etapaId === etapaId) return
    const destino = atual.funil.etapas.find((e) => e.id === etapaId)
    if (!destino) return

    const aplicar = (de: string, para: string) =>
      setBoard((b) => {
        if (!b) return b
        const totais = { ...b.totais }
        const valor = lead.valor ?? 0
        totais[de] = { total: Math.max(0, (totais[de]?.total ?? 0) - 1), valor: Math.max(0, (totais[de]?.valor ?? 0) - valor) }
        totais[para] = { total: (totais[para]?.total ?? 0) + 1, valor: (totais[para]?.valor ?? 0) + valor }
        return { ...b, totais, leads: b.leads.map((item) => (item.id === lead.id ? { ...item, etapaId: para, movidoEm: new Date().toISOString() } : item)) }
      })

    aplicar(lead.etapaId, etapaId)
    setOcupadoId(lead.id)
    void moverLeadNoFunilAction(atual.funil.id, leadId, etapaId).then((res) => {
      setOcupadoId(null)
      if (res.ok) {
        toast.success(`${lead.nome}: ${res.message}`)
        // Os resumos (ganhos, perdidos, conversão) dependem do tipo da etapa: recarrega sem travar a tela.
        void carregarFunilAction(atual.funil.id).then((r) => r.ok && r.board && setBoard(r.board))
      } else {
        aplicar(etapaId, lead.etapaId)
        toast.error(`${lead.nome}: ${res.message}`)
      }
    })
  }, [])

  const etapas = board?.funil.etapas ?? []
  const inativo = board ? !board.funil.ativo : false

  const { arrasto, fantasmaRef, acabouDeArrastarRef, iniciarGesto } = useArrastoDeCards<FunilCartao & { id: string }, string>(scrollRef, {
    // O hook trabalha com o id do cartão (vínculo); o servidor precisa do id do lead.
    aoSoltar: (vinculoId, destino) => {
      const lead = boardRef.current?.leads.find((item) => item.id === vinculoId)
      if (lead) moverCartao(lead.leadId, destino)
    },
    colunaValida: (valor) => (boardRef.current?.funil.etapas ?? []).some((e) => e.id === valor),
  })

  const termo = busca.trim().toLowerCase()
  const porEtapa = useMemo(() => {
    const mapa = new Map<string, FunilCartao[]>(etapas.map((e) => [e.id, []]))
    for (const lead of board?.leads ?? []) {
      if (termo && !`${lead.nome} ${lead.telefone} ${lead.produto} ${lead.marca}`.toLowerCase().includes(termo)) continue
      mapa.get(lead.etapaId)?.push(lead)
    }
    return mapa
  }, [board, etapas, termo])

  function salvarValor() {
    if (!editandoValor || !board) return
    const numero = lerValorFunil(valorTexto)
    if (Number.isNaN(numero)) return void toast.error("Informe um valor válido.")
    const alvo = editandoValor
    startTransition(async () => {
      const res = await definirValorFunilAction(board.funil.id, alvo.leadId, numero)
      if (!res.ok) return void toast.error(res.message)
      toast.success(res.message)
      setEditandoValor(null)
      await carregar(board.funil.id)
    })
  }

  function confirmarRemocao() {
    if (!removendo || !board) return
    const alvo = removendo
    startTransition(async () => {
      const res = await removerLeadDoFunilAction(board.funil.id, alvo.leadId)
      if (!res.ok) toast.error(res.message)
      else {
        toast.success(res.message)
        await carregar(board.funil.id)
      }
      setRemovendo(null)
    })
  }

  function confirmarExclusao() {
    if (!board) return
    const id = board.funil.id
    startTransition(async () => {
      const res = await excluirFunilAction(id)
      if (!res.ok) {
        toast.error(res.message)
        setExcluindo(false)
        return
      }
      toast.success(res.message)
      setExcluindo(false)
      const proximo = funis.find((f) => f.id !== id)
      if (proximo) await carregar(proximo.id)
      else {
        setBoard(null)
        setFunilId(null)
      }
    })
  }

  const funilAtual = funis.find((f) => f.id === funilId) ?? null

  if (funis.length === 0) {
    return (
      <>
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Filter />
            </EmptyMedia>
            <EmptyTitle>Nenhum funil de vendas</EmptyTitle>
            <EmptyDescription>Crie um funil para acompanhar cada lead da primeira conversa até o fechamento.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => { setEditandoFunil(false); setFormAberto(true) }}>
              <Plus className="size-4" />
              Novo funil
            </Button>
          </EmptyContent>
        </Empty>
        <FunilFormDialog open={formAberto} onOpenChange={setFormAberto} funil={null} aoSalvar={(id) => void carregar(id)} />
      </>
    )
  }

  const resumo = board?.resumo
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SelectField
          value={funilId ?? ""}
          onValueChange={selecionar}
          opcoes={funis.map((f) => ({ value: f.id, label: f.ativo ? f.nome : `${f.nome} (inativo)` }))}
          placeholder="Selecione o funil"
          className="w-full sm:w-64"
        />
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar lead" aria-label="Buscar leads no funil" className="pl-8 pr-8" />
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
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => { setEditandoFunil(false); setFormAberto(true) }}>
            <Plus className="size-4" />
            Novo funil
          </Button>
          {board ? (
            <>
              <Button variant="outline" onClick={() => setEtapasAberto(true)}>
                <Settings2 className="size-4" />
                Etapas
              </Button>
              <Button variant="outline" onClick={() => { setEditandoFunil(true); setFormAberto(true) }}>
                <Pencil className="size-4" />
                Editar
              </Button>
              <Button variant="outline" onClick={() => setExcluindo(true)}>
                <Trash2 className="size-4" />
                Excluir
              </Button>
              <Button onClick={() => setAdicionarAberto(true)} disabled={inativo}>
                <UserPlus className="size-4" />
                Adicionar lead
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {board && resumo ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
          {board.funil.descricao ? <span className="basis-full">{board.funil.descricao}</span> : null}
          <span>
            <strong className="tabular-nums text-foreground">{resumo.emAndamento}</strong> em andamento ·{" "}
            <strong className="tabular-nums text-foreground">{formatarValorFunil(resumo.valorEmAndamento)}</strong>
          </span>
          <span>
            <strong className="tabular-nums text-foreground">{resumo.ganhos}</strong> ganhos ·{" "}
            <strong className="tabular-nums text-foreground">{formatarValorFunil(resumo.valorGanho)}</strong>
          </span>
          <span>
            <strong className="tabular-nums text-foreground">{resumo.perdidos}</strong> perdidos
          </span>
          <span>
            Conversão: <strong className="tabular-nums text-foreground">{resumo.conversao === null ? "—" : `${resumo.conversao.toFixed(1).replace(".", ",")}%`}</strong>
          </span>
          {inativo ? <Badge variant="secondary">Funil inativo</Badge> : null}
        </div>
      ) : null}

      {board ? (
        <div
          ref={scrollRef}
          aria-busy={carregando}
          className={cn(
            "-mx-4 flex h-[calc(100dvh-16rem)] min-h-[380px] gap-3 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6",
            !arrasto && "snap-x snap-mandatory md:snap-none",
            carregando && "opacity-60",
          )}
        >
          {etapas.map((etapa) => (
            <Coluna
              key={etapa.id}
              etapa={etapa}
              leads={porEtapa.get(etapa.id) ?? []}
              total={board.totais[etapa.id]?.total ?? 0}
              valor={board.totais[etapa.id]?.valor ?? 0}
              limite={board.limitePorColuna}
              filtrando={termo.length > 0}
              etapas={etapas}
              arrastandoId={arrasto?.lead.id ?? null}
              ocupadoId={ocupadoId}
              inativo={inativo}
              sobre={arrasto?.sobre === etapa.id && arrasto.lead.etapaId !== etapa.id}
              onGesto={iniciarGesto as CartaoProps["onGesto"]}
              onMover={(lead, etapaId) => moverCartao(lead.leadId, etapaId)}
              onValor={(lead) => {
                setValorTexto(lead.valor === null ? "" : String(lead.valor).replace(".", ","))
                setEditandoValor(lead)
              }}
              onRemover={setRemovendo}
              acabouDeArrastarRef={acabouDeArrastarRef}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center py-16">
          <Spinner className="size-5" />
        </div>
      )}

      {arrasto ? <Fantasma estado={arrasto} fantasmaRef={fantasmaRef} etapas={etapas} /> : null}

      <FunilFormDialog
        open={formAberto}
        onOpenChange={setFormAberto}
        funil={editandoFunil ? (funilAtual ?? null) : null}
        aoSalvar={(id) => void carregar(id)}
      />
      {board ? (
        <>
          <FunilEtapasDialog open={etapasAberto} onOpenChange={setEtapasAberto} board={board} aoSalvar={() => void carregar(board.funil.id)} />
          <FunilAdicionarLeadDialog open={adicionarAberto} onOpenChange={setAdicionarAberto} funil={board.funil} aoAdicionar={() => void carregar(board.funil.id)} />
        </>
      ) : null}

      <Dialog open={editandoValor !== null} onOpenChange={(aberto) => !aberto && !pending && setEditandoValor(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Valor do negócio</DialogTitle>
            <DialogDescription>Valor estimado de {editandoValor?.nome}. Deixe em branco para remover.</DialogDescription>
          </DialogHeader>
          <Input value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" aria-label="Valor do negócio" autoFocus />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditandoValor(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={salvarValor} disabled={pending}>
              {pending ? <Spinner /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removendo !== null} onOpenChange={(aberto) => !aberto && !pending && setRemovendo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover do funil?</AlertDialogTitle>
            <AlertDialogDescription>{removendo?.nome} sai deste funil. O cadastro do lead e as conversas continuam como estão.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarRemocao} disabled={pending}>
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={excluindo} onOpenChange={(aberto) => !aberto && !pending && setExcluindo(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o funil {board?.funil.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              As etapas e a posição de {board?.funil.totalLeads ?? 0} {board?.funil.totalLeads === 1 ? "lead" : "leads"} neste funil serão apagadas. Os cadastros dos leads não são afetados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarExclusao} disabled={pending}>
              Excluir funil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
