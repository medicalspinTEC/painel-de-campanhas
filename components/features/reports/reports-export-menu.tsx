"use client"

import { useState } from "react"
import { Braces, Download, FileSpreadsheet, FileText, FileType } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  exportReportToCsv,
  exportReportToJson,
  exportReportToPdf,
  exportReportToXlsx,
  type ReportExportData,
} from "@/lib/report-export"

type Formato = "xlsx" | "csv" | "pdf" | "json"

const EXPORTADORES: Record<Formato, (data: ReportExportData) => void> = {
  xlsx: exportReportToXlsx,
  csv: exportReportToCsv,
  pdf: exportReportToPdf,
  json: exportReportToJson,
}

const LABEL_FORMATO: Record<Formato, string> = {
  xlsx: "Excel (.xlsx)",
  csv: "CSV (.csv)",
  pdf: "PDF (.pdf)",
  json: "JSON (.json)",
}

const ICONE_FORMATO: Record<Formato, typeof FileSpreadsheet> = {
  xlsx: FileSpreadsheet,
  csv: FileText,
  pdf: FileType,
  json: Braces,
}

/**
 * Exporta os relatórios ATUALMENTE exibidos — já com o período aplicado nos
 * filtros da página — inteiramente no navegador, a partir dos dados já
 * carregados. Para exportar o histórico completo, o usuário limpa o filtro
 * de período primeiro (mesma lógica da exportação de logs).
 */
export function ReportsExportMenu({ data }: { data: ReportExportData }) {
  const [gerando, setGerando] = useState<Formato | null>(null)

  function exportar(formato: Formato) {
    setGerando(formato)
    try {
      EXPORTADORES[formato](data)
      toast.success(`Relatórios exportados em ${LABEL_FORMATO[formato]}.`)
    } catch (error) {
      console.error("[v0] Falha ao exportar relatórios:", error)
      toast.error("Não foi possível gerar o arquivo. Tente novamente.")
    } finally {
      setGerando(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" disabled={gerando !== null}>
            <Download className="size-4" />
            Exportar relatórios
          </Button>
        }
      />
      <DropdownMenuContent align="end">
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
