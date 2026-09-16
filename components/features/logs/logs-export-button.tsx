"use client"

import { Download } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { AppLogRow } from "@/services/app-logs"

function baixarJson(dados: unknown, nome: string) {
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = nome
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Exporta os erros de sistema ATUALMENTE exibidos (já com os filtros de
 * nível/origem/período aplicados na consulta) como um arquivo `.json`. Como
 * os dados vêm da mesma lista filtrada renderizada na tabela, o arquivo nunca
 * sai maior do que o que está na tela — para exportar tudo, o usuário limpa
 * os filtros primeiro.
 */
export function LogsExportButton({ logs, filtrosResumo }: { logs: AppLogRow[]; filtrosResumo: string }) {
  function exportar() {
    if (logs.length === 0) {
      toast.error("Nenhum erro para exportar com os filtros atuais.")
      return
    }

    const payload = {
      exportadoEm: new Date().toISOString(),
      filtros: filtrosResumo,
      total: logs.length,
      erros: logs,
    }

    const carimbo = new Date().toISOString().slice(0, 10)
    baixarJson(payload, `erros-sistema-${carimbo}.json`)
    toast.success(`${logs.length} erro(s) exportado(s) em JSON.`)
  }

  return (
    <Button variant="outline" size="sm" onClick={exportar} disabled={logs.length === 0}>
      <Download className="size-4" />
      Exportar JSON
    </Button>
  )
}
