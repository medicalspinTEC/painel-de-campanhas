"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

export type AbaChat = "leads" | "equipe"

const URL_DA_ABA: Record<AbaChat, string> = { leads: "/chat", equipe: "/chat/interno" }

interface ChatAbasContexto {
  ativa: AbaChat
  selecionar: (aba: AbaChat) => void
  naoLidasEquipe: number
  definirNaoLidasEquipe: (total: number) => void
}

const ChatAbasContext = createContext<ChatAbasContexto | null>(null)

export function useChatAbas() {
  return useContext(ChatAbasContext)
}

/**
 * Mantém as duas abas do chat (Leads e Equipe) montadas ao mesmo tempo e só alterna qual aparece.
 * Trocar de aba não faz ida ao servidor: é só estado do cliente, então é instantâneo. O histórico
 * rolado, a conversa aberta e o rascunho de cada aba ficam como estavam.
 *
 * A aba inativa fica empilhada por cima da outra, invisível e inerte (sem foco nem clique), em vez de
 * `display: none` — assim o navegador preserva a posição de rolagem de cada lista.
 */
export function ChatShell({
  abaInicial,
  leads,
  equipe,
}: {
  abaInicial: AbaChat
  leads: ReactNode
  equipe: ReactNode
}) {
  const [ativa, setAtiva] = useState<AbaChat>(abaInicial)
  const [naoLidasEquipe, setNaoLidasEquipe] = useState(0)

  const selecionar = useCallback((aba: AbaChat) => {
    setAtiva(aba)
    // Mantém a URL em dia (atualizar a página reabre na mesma aba) sem navegar.
    if (window.location.pathname !== URL_DA_ABA[aba]) window.history.replaceState(null, "", URL_DA_ABA[aba])
  }, [])

  const valor = useMemo<ChatAbasContexto>(
    () => ({ ativa, selecionar, naoLidasEquipe, definirNaoLidasEquipe: setNaoLidasEquipe }),
    [ativa, selecionar, naoLidasEquipe],
  )

  const camada = "col-start-1 row-start-1 min-w-0"
  const escondida = "invisible pointer-events-none"
  return (
    <ChatAbasContext.Provider value={valor}>
      <div className="grid">
        <div className={cn(camada, ativa !== "leads" && escondida)} aria-hidden={ativa !== "leads"} inert={ativa !== "leads"}>
          {leads}
        </div>
        <div className={cn(camada, ativa !== "equipe" && escondida)} aria-hidden={ativa !== "equipe"} inert={ativa !== "equipe"}>
          {equipe}
        </div>
      </div>
    </ChatAbasContext.Provider>
  )
}
