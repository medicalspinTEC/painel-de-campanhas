"use client"

import { useEffect } from "react"

import { TEMA_COOKIE, type TemaApp } from "@/lib/temas"

/** Troca o tema só no documento (usado também na pré-visualização das Configurações). */
export function aplicarTemaNoDocumento(tema: TemaApp) {
  if (typeof document !== "undefined") document.documentElement.dataset.tema = tema
}

/**
 * Aplica o tema salvo no banco e guarda uma cópia em cookie. O cookie é lido
 * pelo layout raiz para o servidor já entregar o <html> com o tema certo, sem
 * o "piscar" da cor padrão antes do carregamento.
 */
export function AppThemeColors({ tema }: { tema: TemaApp }) {
  useEffect(() => {
    aplicarTemaNoDocumento(tema)
    document.cookie = `${TEMA_COOKIE}=${tema}; path=/; max-age=31536000; samesite=lax`
  }, [tema])

  return null
}
