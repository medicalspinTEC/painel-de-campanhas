"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { usePathname } from "next/navigation"
import { MessageCircle, X, Bot } from "lucide-react"

import { AssistantChat } from "@/components/features/assistant/assistant-leads"
import { Button } from "@/components/ui/button"

export function AssistantShortcut() {
  const pathname = usePathname()
  const [aberto, setAberto] = useState(false)

  useEffect(() => {
    if (!aberto) return

    function fecharAoClicarFora(event: PointerEvent) {
      if (!(event.target instanceof Element)) return
      if (event.target.closest("#assistant-floating-panel, #assistant-shortcut-trigger, [data-slot='dialog-content'], [data-slot='dialog-overlay']")) return
      setAberto(false)
    }

    document.addEventListener("pointerdown", fecharAoClicarFora)
    return () => document.removeEventListener("pointerdown", fecharAoClicarFora)
  }, [aberto])

  if (pathname === "/assistente" || pathname.startsWith("/assistente/")) return null

  return (
    <>
      {aberto && typeof document !== "undefined"
        ? createPortal(
            <section
              id="assistant-floating-panel"
              aria-label="Chat do Assistente"
              className="fixed right-4 bottom-20 z-40 h-[min(38rem,calc(100dvh-6.5rem))] w-[min(28rem,calc(100vw-2rem))] sm:right-6"
            >
              <AssistantChat compact onClose={() => setAberto(false)} />
            </section>,
            document.body,
          )
        : null}
      <Button
        id="assistant-shortcut-trigger"
        type="button"
        aria-label={aberto ? "Fechar Assistente" : "Abrir o chat do Assistente"}
        aria-expanded={aberto}
        aria-controls={aberto ? "assistant-floating-panel" : undefined}
        title={aberto ? "Fechar Assistente" : "Consultar o Assistente nesta página"}
        onClick={() => setAberto((atual) => !atual)}
        className="flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg ring-1 ring-foreground/10 transition hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {aberto ? <X className="size-4" /> : <Bot className="size-4" />}
        <span>{aberto ? "Fechar assistente" : "Consultar assistente"}</span>
      </Button>
    </>
  )
}