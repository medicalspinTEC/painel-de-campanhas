"use client"

import { useEffect, useState, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react"

const DISTANCIA_MOUSE = 5
const DISTANCIA_TOQUE = 10
const ESPERA_TOQUE_MS = 280
const BORDA_ROLAGEM = 56

/* ------------------------------------------------------------------ */
/* Arrasto por eventos de ponteiro (mouse, caneta e toque, sem biblioteca) */
/* ------------------------------------------------------------------ */

export type EstadoArrasto<L, C extends string> = {
  lead: L
  largura: number
  x: number
  y: number
  dx: number
  dy: number
  sobre: C | null
}

type Sessao<L> = {
  lead: L
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

type OpcoesArrasto<C extends string> = {
  aoSoltar: (leadId: string, destino: C) => void
  /** Confere se o valor lido de `data-coluna` é mesmo uma coluna deste quadro. */
  colunaValida: (valor: string) => boolean
}

function colunaSob<C extends string>(x: number, y: number, valida: (valor: string) => boolean): C | null {
  const coluna = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-coluna]")
  const chave = coluna?.dataset.coluna
  return chave && valida(chave) ? (chave as C) : null
}

/**
 * Arrasto de cartões por eventos de ponteiro, compartilhado pelo Kanban de leads (colunas = status)
 * e pelo Kanban de campanha (colunas = etapas). Cada coluna marca `data-coluna` (e o corpo rolável
 * `data-coluna-corpo`); os cartões que não devem iniciar arrasto marcam `data-sem-arrasto`.
 */
export function useArrastoDeCards<L extends { id: string }, C extends string>(
  scrollRef: RefObject<HTMLDivElement | null>,
  opcoes: OpcoesArrasto<C>,
) {
  const [arrasto, setArrasto] = useState<EstadoArrasto<L, C> | null>(null)
  const fantasmaRef = useRef<HTMLDivElement | null>(null)
  const opcoesRef = useRef(opcoes)
  const acabouDeArrastarRef = useRef(false)

  useEffect(() => {
    opcoesRef.current = opcoes
  })

  // O motor vive fora do ciclo de render: os listeners precisam de identidade
  // estável para serem removidos, e a posição do cartão não pode causar render.
  const [motor] = useState(() => {
    let sessao: Sessao<L> | null = null
    let sobreAtual: C | null = null
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
      const novo = colunaSob<C>(s.x, s.y, opcoesRef.current.colunaValida)
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
      sobreAtual = colunaSob<C>(s.x, s.y, opcoesRef.current.colunaValida)
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
      const destino = estavaArrastando ? (colunaSob<C>(evento.clientX, evento.clientY, opcoesRef.current.colunaValida) ?? sobreAtual) : null
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

    function iniciar(evento: ReactPointerEvent<HTMLElement>, lead: L) {
      if (sessao) return
      if (evento.pointerType === "mouse" && evento.button !== 0) return
      if ((evento.target as HTMLElement).closest("[data-sem-arrasto]")) return

      const caixa = evento.currentTarget.getBoundingClientRect()
      const s: Sessao<L> = {
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

