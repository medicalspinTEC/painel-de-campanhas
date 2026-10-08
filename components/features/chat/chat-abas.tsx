"use client"

import { MessagesSquare, Users } from "lucide-react"

import { useChatAbas } from "@/components/features/chat/chat-shell"
import { cn } from "@/lib/utils"

/** Alterna entre o chat com leads (WhatsApp) e o chat interno da equipe, sem recarregar a página. */
export function ChatAbas() {
  const abas = useChatAbas()
  if (!abas) return null
  const { ativa, selecionar, naoLidasEquipe } = abas

  const base = "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 text-sm font-medium transition-colors"
  const ligada = "border-primary/30 bg-primary/15 text-primary"
  const desligada = "border-transparent text-muted-foreground hover:bg-muted"
  return (
    <nav aria-label="Seções do chat" className="flex items-center gap-1.5">
      <button type="button" aria-current={ativa === "leads" ? "page" : undefined} className={cn(base, ativa === "leads" ? ligada : desligada)} onClick={() => selecionar("leads")}>
        <MessagesSquare className="size-4" />
        Leads
      </button>
      <button type="button" aria-current={ativa === "equipe" ? "page" : undefined} className={cn(base, ativa === "equipe" ? ligada : desligada)} onClick={() => selecionar("equipe")}>
        <Users className="size-4" />
        Equipe
        {naoLidasEquipe > 0 ? (
          <span className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground tabular-nums">
            {naoLidasEquipe > 99 ? "99+" : naoLidasEquipe}
          </span>
        ) : null}
      </button>
    </nav>
  )
}
