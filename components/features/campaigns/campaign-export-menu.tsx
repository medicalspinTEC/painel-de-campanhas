"use client"

import { useState } from "react"
import { Download, FileSpreadsheet, FileText, FileType } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  exportCampaignToCsv,
  exportCampaignToPdf,
  exportCampaignToXlsx,
  type CampaignExportData,
} from "@/lib/campaign-export"

type Formato = "xlsx" | "csv" | "pdf"

const EXPORTADORES: Record<Formato, (data: CampaignExportData) => void> = {
  xlsx: exportCampaignToXlsx,
  csv: exportCampaignToCsv,
  pdf: exportCampaignToPdf,
}

const LABEL_FORMATO: Record<Formato, string> = {
  xlsx: "Excel (.xlsx)",
  csv: "CSV (.csv)",
  pdf: "PDF (.pdf)",
}

/**
 * Exporta o resumo da campanha (KPIs) e os leads nas três situações —
 * responderam, não responderam (ainda na campanha) e saíram sem responder —
 * inteiramente no navegador, a partir dos dados já carregados na página.
 */
export function CampaignExportMenu({ data }: { data: CampaignExportData }) {
  const [gerando, setGerando] = useState<Formato | null>(null)

  function exportar(formato: Formato) {
    setGerando(formato)
    try {
      EXPORTADORES[formato](data)
      toast.success(`Resultados exportados em ${LABEL_FORMATO[formato]}.`)
    } catch (error) {
      console.error("[v0] Falha ao exportar resultados da campanha:", error)
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
            Exportar resultados
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => exportar("xlsx")} disabled={gerando !== null}>
          <FileSpreadsheet className="size-4" />
          {LABEL_FORMATO.xlsx}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportar("csv")} disabled={gerando !== null}>
          <FileText className="size-4" />
          {LABEL_FORMATO.csv}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportar("pdf")} disabled={gerando !== null}>
          <FileType className="size-4" />
          {LABEL_FORMATO.pdf}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
