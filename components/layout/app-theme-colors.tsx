"use client"

import { useEffect } from "react"

import type { AppThemeColors as AppThemeColorsValue } from "@/services/settings"

function corDeTexto(cor: string) {
  const rgb = cor.slice(1).match(/.{2}/g)?.map((canal) => Number.parseInt(canal, 16) / 255)
  if (!rgb || rgb.length !== 3) return "#ffffff"

  const linear = rgb.map((canal) => (canal <= 0.04045 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4))
  const luminancia = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
  return luminancia > 0.42 ? "#18211e" : "#ffffff"
}

export function aplicarAppThemeColors(cores: AppThemeColorsValue) {
  if (typeof document === "undefined") return () => {}

  const root = document.documentElement
  const variaveis: Record<string, string> = {
    "--primary": cores.corPrincipal,
    "--primary-foreground": corDeTexto(cores.corPrincipal),
    "--ring": cores.corPrincipal,
    "--sidebar-primary": cores.corPrincipal,
    "--sidebar-primary-foreground": corDeTexto(cores.corPrincipal),
    "--sidebar-ring": cores.corPrincipal,
    "--secondary": cores.corSecundaria,
    "--secondary-foreground": corDeTexto(cores.corSecundaria),
    "--accent": cores.corTerciaria,
    "--accent-foreground": corDeTexto(cores.corTerciaria),
    "--sidebar-accent": cores.corTerciaria,
    "--sidebar-accent-foreground": corDeTexto(cores.corTerciaria),
    "--chart-1": cores.corPrincipal,
    "--chart-3": cores.corTerciaria,
  }

  const anteriores = new Map<string, string>()
  for (const [variavel, valor] of Object.entries(variaveis)) {
    anteriores.set(variavel, root.style.getPropertyValue(variavel))
    root.style.setProperty(variavel, valor)
  }

  return () => {
    for (const [variavel, valor] of anteriores) {
      if (valor) root.style.setProperty(variavel, valor)
      else root.style.removeProperty(variavel)
    }
  }
}

export function AppThemeColors({ cores }: { cores: AppThemeColorsValue }) {
  useEffect(
    () => aplicarAppThemeColors(cores),
    [cores.corPrincipal, cores.corSecundaria, cores.corTerciaria],
  )

  return null
}