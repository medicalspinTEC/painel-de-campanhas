"use client"

import { useEffect, useRef, useState } from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

const INTERVALO_NOVA_TENTATIVA = 10_000

function iniciais(nome: string) {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?"
}

/**
 * Avatar com a foto do WhatsApp do lead.
 * - Só busca quando está visível na tela.
 * - Falha temporária (502/rede): tenta de novo a cada 10 s.
 * - Sem foto ou número fora do WhatsApp (410): mostra só as iniciais e para de tentar
 *   (volta a consultar quando o lead for editado).
 */
export function LeadAvatar({
  leadId,
  nome,
  telefone,
  className,
  fallbackClassName,
}: {
  leadId: string
  nome: string
  /** Muda quando o lead é editado: reinicia as tentativas. */
  telefone?: string
  className?: string
  fallbackClassName?: string
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [visivel, setVisivel] = useState(false)
  const raiz = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = raiz.current
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisivel(true)
      return
    }
    const observer = new IntersectionObserver(([entrada]) => setVisivel(entrada.isIntersecting))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    // Nunca reaproveita a foto de outro lead (o componente é reutilizado ao trocar de conversa).
    setSrc(null)
    if (!visivel) return
    let cancelado = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let objectUrl: string | null = null

    async function buscar() {
      let continuar = true
      try {
        const resposta = await fetch(`/api/leads/${leadId}/foto`)
        if (cancelado) return
        if (resposta.ok) {
          objectUrl = URL.createObjectURL(await resposta.blob())
          if (cancelado) return URL.revokeObjectURL(objectUrl)
          setSrc(objectUrl)
          continuar = false
        } else if (resposta.status === 410) {
          continuar = false
        }
      } catch {
        // falha de rede: tenta de novo
      }
      if (continuar && !cancelado) timer = setTimeout(buscar, INTERVALO_NOVA_TENTATIVA)
    }

    void buscar()
    return () => {
      cancelado = true
      if (timer) clearTimeout(timer)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [leadId, telefone, visivel])

  return (
    <Avatar className={className}>
      {/* span observável: o Avatar do base-ui não repassa ref de forma garantida */}
      <span ref={raiz} className="absolute inset-0" aria-hidden />
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback className={fallbackClassName}>{iniciais(nome)}</AvatarFallback>
    </Avatar>
  )
}
