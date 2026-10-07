"use client"

import { useEffect } from "react"

/** Registra o service worker (só em produção) para o app poder ser instalado no celular. */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return
    if (!("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {})
  }, [])

  return null
}
