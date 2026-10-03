"use client"

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react"
import { Maximize2, Minus, Plus, X } from "lucide-react"

import { ICONES, resumoDoNo } from "@/components/features/nocode/node-visuals"
import { Button } from "@/components/ui/button"
import {
  alturaDoNo,
  NODE_CATALOG,
  NODE_LARGURA,
  posicaoEntrada,
  posicaoSaida,
  type FlowEdge,
  type FlowNode,
} from "@/lib/nocode/catalog"
import { cn } from "@/lib/utils"

export type Selecao = { tipo: "no" | "aresta"; id: string } | null

const ZOOM_MIN = 0.4
const ZOOM_MAX = 1.6
const GRADE = 8

function caminho(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(48, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

export function FlowCanvas({
  nodes,
  edges,
  selecao,
  onSelect,
  onMoverNo,
  onConectar,
  onRemoverAresta,
  centroRef,
}: {
  nodes: FlowNode[]
  edges: FlowEdge[]
  selecao: Selecao
  onSelect: (selecao: Selecao) => void
  onMoverNo: (id: string, posicao: { x: number; y: number }) => void
  onConectar: (origem: string, saida: string, destino: string) => void
  onRemoverAresta: (id: string) => void
  /** O editor lê daqui o ponto (em coordenadas do fluxo) no centro da área visível. */
  centroRef: MutableRefObject<(() => { x: number; y: number }) | null>
}) {
  const container = useRef<HTMLDivElement>(null)
  const [pan, setPan] = useState({ x: 40, y: 40 })
  const [zoom, setZoom] = useState(1)
  const panRef = useRef(pan)
  const zoomRef = useRef(zoom)
  panRef.current = pan
  zoomRef.current = zoom
  const [ligando, setLigando] = useState<{ origem: string; saida: string; x: number; y: number } | null>(null)

  const paraMundo = useCallback((clientX: number, clientY: number) => {
    const rect = container.current?.getBoundingClientRect()
    const esquerda = rect?.left ?? 0
    const topo = rect?.top ?? 0
    return {
      x: (clientX - esquerda - panRef.current.x) / zoomRef.current,
      y: (clientY - topo - panRef.current.y) / zoomRef.current,
    }
  }, [])

  useEffect(() => {
    centroRef.current = () => {
      const rect = container.current?.getBoundingClientRect()
      return paraMundo((rect?.left ?? 0) + (rect?.width ?? 600) / 2, (rect?.top ?? 0) + (rect?.height ?? 400) / 2)
    }
    return () => {
      centroRef.current = null
    }
  }, [centroRef, paraMundo])

  // Zoom com a roda do mouse, ancorado no cursor (listener não passivo para poder impedir o scroll da página).
  useEffect(() => {
    const el = container.current
    if (!el) return
    function aoRolar(event: WheelEvent) {
      event.preventDefault()
      const rect = el!.getBoundingClientRect()
      const atual = zoomRef.current
      const novo = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, atual * (event.deltaY < 0 ? 1.1 : 1 / 1.1)))
      if (novo === atual) return
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      const mundoX = (px - panRef.current.x) / atual
      const mundoY = (py - panRef.current.y) / atual
      setZoom(novo)
      setPan({ x: px - mundoX * novo, y: py - mundoY * novo })
    }
    el.addEventListener("wheel", aoRolar, { passive: false })
    return () => el.removeEventListener("wheel", aoRolar)
  }, [])

  function ajustarZoom(fator: number) {
    const rect = container.current?.getBoundingClientRect()
    if (!rect) return
    const atual = zoomRef.current
    const novo = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, atual * fator))
    const px = rect.width / 2
    const py = rect.height / 2
    const mundoX = (px - panRef.current.x) / atual
    const mundoY = (py - panRef.current.y) / atual
    setZoom(novo)
    setPan({ x: px - mundoX * novo, y: py - mundoY * novo })
  }

  /** Enquadra todos os blocos na área visível. */
  function enquadrar() {
    const rect = container.current?.getBoundingClientRect()
    if (!rect || nodes.length === 0) {
      setZoom(1)
      setPan({ x: 40, y: 40 })
      return
    }
    const minX = Math.min(...nodes.map((n) => n.position.x))
    const minY = Math.min(...nodes.map((n) => n.position.y))
    const maxX = Math.max(...nodes.map((n) => n.position.x + NODE_LARGURA))
    const maxY = Math.max(...nodes.map((n) => n.position.y + alturaDoNo(n.type)))
    const margem = 48
    const novo = Math.min(
      1,
      Math.max(ZOOM_MIN, Math.min((rect.width - margem * 2) / (maxX - minX), (rect.height - margem * 2) / (maxY - minY))),
    )
    setZoom(novo)
    setPan({
      x: (rect.width - (maxX - minX) * novo) / 2 - minX * novo,
      y: (rect.height - (maxY - minY) * novo) / 2 - minY * novo,
    })
  }

  // Enquadra ao abrir o editor.
  const enquadradoRef = useRef(false)
  useEffect(() => {
    if (enquadradoRef.current) return
    enquadradoRef.current = true
    enquadrar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function aoPressionarFundo(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return
    const inicio = { x: event.clientX, y: event.clientY, pan: panRef.current }
    let moveu = false
    function mover(e: PointerEvent) {
      const dx = e.clientX - inicio.x
      const dy = e.clientY - inicio.y
      if (Math.abs(dx) + Math.abs(dy) > 3) moveu = true
      setPan({ x: inicio.pan.x + dx, y: inicio.pan.y + dy })
    }
    function soltar() {
      window.removeEventListener("pointermove", mover)
      window.removeEventListener("pointerup", soltar)
      if (!moveu) onSelect(null)
    }
    window.addEventListener("pointermove", mover)
    window.addEventListener("pointerup", soltar)
  }

  function aoPressionarNo(event: ReactPointerEvent<HTMLDivElement>, no: FlowNode) {
    if (event.button !== 0) return
    event.stopPropagation()
    onSelect({ tipo: "no", id: no.id })
    const inicioMundo = paraMundo(event.clientX, event.clientY)
    const origem = { ...no.position }
    function mover(e: PointerEvent) {
      const atual = paraMundo(e.clientX, e.clientY)
      onMoverNo(no.id, {
        x: Math.round((origem.x + atual.x - inicioMundo.x) / GRADE) * GRADE,
        y: Math.round((origem.y + atual.y - inicioMundo.y) / GRADE) * GRADE,
      })
    }
    function soltar() {
      window.removeEventListener("pointermove", mover)
      window.removeEventListener("pointerup", soltar)
    }
    window.addEventListener("pointermove", mover)
    window.addEventListener("pointerup", soltar)
  }

  function aoPressionarSaida(event: ReactPointerEvent<HTMLElement>, no: FlowNode, saida: string) {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    const ponto = paraMundo(event.clientX, event.clientY)
    setLigando({ origem: no.id, saida, x: ponto.x, y: ponto.y })
    function mover(e: PointerEvent) {
      const p = paraMundo(e.clientX, e.clientY)
      setLigando({ origem: no.id, saida, x: p.x, y: p.y })
    }
    function soltar(e: PointerEvent) {
      window.removeEventListener("pointermove", mover)
      window.removeEventListener("pointerup", soltar)
      setLigando(null)
      const alvo = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>(
        "[data-entrada-no]",
      )
      const destino = alvo?.dataset.entradaNo
      if (destino && destino !== no.id) onConectar(no.id, saida, destino)
    }
    window.addEventListener("pointermove", mover)
    window.addEventListener("pointerup", soltar)
  }

  const porId = new Map(nodes.map((n) => [n.id, n]))
  const origemLigando = ligando ? porId.get(ligando.origem) : undefined
  const arestaSelecionada = selecao?.tipo === "aresta" ? edges.find((e) => e.id === selecao.id) : undefined
  let botaoAresta: { x: number; y: number } | null = null
  if (arestaSelecionada) {
    const o = porId.get(arestaSelecionada.source)
    const d = porId.get(arestaSelecionada.target)
    if (o && d) {
      const p1 = posicaoSaida(o, arestaSelecionada.sourceHandle)
      const p2 = posicaoEntrada(d)
      botaoAresta = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
    }
  }

  return (
    <div
      ref={container}
      onPointerDown={aoPressionarFundo}
      className="relative h-full w-full touch-none select-none overflow-hidden rounded-lg border bg-muted/30"
      style={{
        backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
        backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
        cursor: ligando ? "crosshair" : undefined,
      }}
    >
      <div
        className="absolute left-0 top-0"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}
      >
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1} aria-hidden>
          {edges.map((aresta) => {
            const o = porId.get(aresta.source)
            const d = porId.get(aresta.target)
            if (!o || !d) return null
            const p1 = posicaoSaida(o, aresta.sourceHandle)
            const p2 = posicaoEntrada(d)
            const selecionada = selecao?.tipo === "aresta" && selecao.id === aresta.id
            const d_ = caminho(p1.x, p1.y, p2.x, p2.y)
            return (
              <g key={aresta.id}>
                <path
                  d={d_}
                  fill="none"
                  stroke={selecionada ? "var(--primary)" : "var(--muted-foreground)"}
                  strokeWidth={selecionada ? 2.5 : 1.75}
                  strokeOpacity={selecionada ? 1 : 0.7}
                />
                <path
                  d={d_}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  style={{ pointerEvents: "stroke", cursor: "pointer" }}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    onSelect({ tipo: "aresta", id: aresta.id })
                  }}
                />
              </g>
            )
          })}
          {ligando && origemLigando ? (
            <path
              d={caminho(
                posicaoSaida(origemLigando, ligando.saida).x,
                posicaoSaida(origemLigando, ligando.saida).y,
                ligando.x,
                ligando.y,
              )}
              fill="none"
              stroke="var(--primary)"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          ) : null}
        </svg>

        {nodes.map((no) => {
          const def = NODE_CATALOG[no.type]
          const Icone = ICONES[def.icone]
          const altura = alturaDoNo(no.type)
          const selecionado = selecao?.tipo === "no" && selecao.id === no.id
          return (
            <div
              key={no.id}
              onPointerDown={(event) => aoPressionarNo(event, no)}
              className={cn(
                "absolute cursor-grab rounded-xl border bg-card shadow-sm transition-shadow active:cursor-grabbing",
                selecionado ? "border-primary ring-2 ring-primary/40" : "hover:shadow-md",
              )}
              style={{ left: no.position.x, top: no.position.y, width: NODE_LARGURA, height: altura }}
            >
              <div className="flex h-full items-center gap-2.5 px-3 pr-6">
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", def.cor)}>
                  <Icone className="size-4" />
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium leading-tight">{no.name}</span>
                  <span className="truncate text-xs leading-tight text-muted-foreground">{resumoDoNo(no)}</span>
                </div>
              </div>

              {def.temEntrada ? (
                <span
                  data-entrada-no={no.id}
                  className="absolute -left-2 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded-full"
                  title="Entrada"
                >
                  <span className="size-2.5 rounded-full border-2 border-muted-foreground bg-card" />
                </span>
              ) : null}

              {def.saidas.map((saida, indice) => (
                <button
                  key={saida.id}
                  type="button"
                  aria-label={saida.label ? `Saída ${saida.label}` : "Saída"}
                  title={saida.label || "Arraste para conectar"}
                  onPointerDown={(event) => aoPressionarSaida(event, no, saida.id)}
                  className="absolute -right-2 flex size-4 -translate-y-1/2 cursor-crosshair items-center justify-center rounded-full"
                  style={{ top: (altura * (indice + 1)) / (def.saidas.length + 1) }}
                >
                  <span
                    className={cn(
                      "size-3 rounded-full border-2 bg-card",
                      saida.id === "true"
                        ? "border-emerald-500"
                        : saida.id === "false"
                          ? "border-rose-500"
                          : "border-primary",
                    )}
                  />
                </button>
              ))}
              {def.saidas.length > 1
                ? def.saidas.map((saida, indice) => (
                    <span
                      key={`rotulo-${saida.id}`}
                      className="pointer-events-none absolute right-3 -translate-y-1/2 text-[10px] font-medium text-muted-foreground"
                      style={{ top: (altura * (indice + 1)) / (def.saidas.length + 1) }}
                    >
                      {saida.label}
                    </span>
                  ))
                : null}
            </div>
          )
        })}

        {botaoAresta && arestaSelecionada ? (
          <button
            type="button"
            aria-label="Remover conexão"
            title="Remover conexão"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onRemoverAresta(arestaSelecionada.id)}
            className="absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-card text-destructive shadow-sm hover:bg-destructive/10"
            style={{ left: botaoAresta.x, top: botaoAresta.y }}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border bg-card p-1 shadow-sm" onPointerDown={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="icon-sm" aria-label="Diminuir zoom" onClick={() => ajustarZoom(1 / 1.2)}>
          <Minus className="size-4" />
        </Button>
        <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="icon-sm" aria-label="Aumentar zoom" onClick={() => ajustarZoom(1.2)}>
          <Plus className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Enquadrar o fluxo" title="Enquadrar" onClick={enquadrar}>
          <Maximize2 className="size-4" />
        </Button>
      </div>

      {nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Fluxo vazio. Clique em um bloco na lista à esquerda para adicioná-lo.
        </div>
      ) : null}
    </div>
  )
}
