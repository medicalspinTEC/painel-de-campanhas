"use client"

import { useState } from "react"
import { Braces, Download, FileSpreadsheet, FileText, FileType } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  exportLeadsToCsv,
  exportLeadsToJson,
  exportLeadsToPdf,
  exportLeadsToXlsx,
  type EscopoExportacao,
  type LeadExportData,
} from "@/lib/lead-export"
import { formatNumber } from "@/lib/format"

type Formato = "xlsx" | "csv" | "json" | "pdf"

const EXPORTADORES: Record<Formato, (data: LeadExportData) => void> = {
  xlsx: exportLeadsToXlsx,
  csv: exportLeadsToCsv,
  json: exportLeadsToJson,
  pdf: exportLeadsToPdf,
}

const LABEL_FORMATO: Record<Formato, string> = {
  xlsx: "Excel (.xlsx)",
  csv: "CSV (.csv)",
  json: "JSON (.json)",
  pdf: "PDF (.pdf)",
}

const ICONE_FORMATO: Record<Formato, typeof FileSpreadsheet> = {
  xlsx: FileSpreadsheet,
  csv: FileText,
  json: Braces,
  pdf: FileType,
}

const DESCRICAO_ESCOPO: Record<EscopoExportacao, string> = {
  selecionados: "selecionado(s)",
  filtrados: "do filtro atual",
  todos: "no total",
}

/**
 * Exporta os leads inteiramente no navegador, a partir dos dados já carregados:
 * os selecionados (se houver), senão tudo o que o filtro atual mostra — em todas
 * as páginas, não só na que está aberta.
 */
export function LeadsExportMenu({ leads, escopo }: LeadExportData) {
  const [gerando, setGerando] = useState<Formato | null>(null)

  function exportar(formato: Formato) {
    setGerando(formato)
    // Deixa o menu fechar e o botão mostrar o estado antes do trabalho síncrono pesado (PDF/XLSX).
    setTimeout(() => {
      try {
        EXPORTADORES[formato]({ leads, escopo })
        toast.success(`${formatNumber(leads.length)} lead(s) exportado(s) em ${LABEL_FORMATO[formato]}.`)
      } catch (error) {
        console.error("[leads] Falha ao exportar leads:", error)
        toast.error("Não foi possível gerar o arquivo. Tente novamente.")
      } finally {
        setGerando(null)
      }
    }, 0)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" disabled={gerando !== null || leads.length === 0} className="flex-1 sm:flex-none">
            <Download className="size-4" />
            {gerando ? "Gerando..." : "Exportar"}
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          {formatNumber(leads.length)} lead(s) {DESCRICAO_ESCOPO[escopo]}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(Object.keys(LABEL_FORMATO) as Formato[]).map((formato) => {
          const Icone = ICONE_FORMATO[formato]
          return (
            <DropdownMenuItem key={formato} onClick={() => exportar(formato)} disabled={gerando !== null}>
              <Icone className="size-4" />
              {LABEL_FORMATO[formato]}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
