"use client"

import Link from "next/link"
import { MessagesSquare, Users } from "lucide-react"

import { useChatAbas } from "@/components/features/chat/chat-shell"
import { cn } from "@/lib/utils"

const base = "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 text-sm font-medium transition-colors"
const ligada = "border-primary/30 bg-primary/15 text-primary"
const desligada = "border-transparent text-muted-foreground hover:bg-muted"

function Selo({ total }: { total: number }) {
  if (total <= 0) return null
  return (
    <span className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground tabular-nums">
      {total > 99 ? "99+" : total}
    </span>
  )
}

/**
 * Alterna entre o chat com leads (WhatsApp) e o chat interno da equipe.
 *
 * Dentro do `ChatShell` a troca é só estado do cliente: as duas abas continuam montadas, então a
 * conversa aberta, o rascunho e a rolagem de cada uma não se perdem. Fora dele (sem o shell) cai
 * para links normais.
 */
export function ChatAbas({ ativa = "leads", naoLidasEquipe = 0 }: { ativa?: "leads" | "equipe"; naoLidasEquipe?: number }) {
  const abas = useChatAbas()
  const atual = abas?.ativa ?? ativa
  const naoLidas = abas?.naoLidasEquipe ?? naoLidasEquipe

  return (
    <nav aria-label="Seções do chat" className="flex items-center gap-1.5">
      {abas ? (
        <>
          <button type="button" aria-current={atual === "leads" ? "page" : undefined} onClick={() => abas.selecionar("leads")} className={cn(base, atual === "leads" ? ligada : desligada)}>
            <MessagesSquare className="size-4" />
            Leads
          </button>
          <button type="button" aria-current={atual === "equipe" ? "page" : undefined} onClick={() => abas.selecionar("equipe")} className={cn(base, atual === "equipe" ? ligada : desligada)}>
            <Users className="size-4" />
            Equipe
            <Selo total={naoLidas} />
          </button>
        </>
      ) : (
        <>
          <Link href="/chat" aria-current={atual === "leads" ? "page" : undefined} className={cn(base, atual === "leads" ? ligada : desligada)}>
            <MessagesSquare className="size-4" />
            Leads
          </Link>
          <Link href="/chat/interno" aria-current={atual === "equipe" ? "page" : undefined} className={cn(base, atual === "equipe" ? ligada : desligada)}>
            <Users className="size-4" />
            Equipe
            <Selo total={naoLidas} />
          </Link>
        </>
      )}
    </nav>
  )
}
