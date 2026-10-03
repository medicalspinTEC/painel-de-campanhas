"use client"

import { useState } from "react"
import { Braces, Download, FileType } from "lucide-react"
import { toast } from "sonner"

import { exportChatsAction } from "@/app/actions/chat"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { exportChatsToJson, exportChatsToPdf } from "@/lib/chat-export"

type Formato = "pdf" | "json"

/**
 * Exporta conversas em PDF ou JSON: a conversa aberta ou todas as que estão
 * na lista (já com busca/filtro aplicados). O histórico é buscado completo no
 * servidor e o arquivo é gerado no navegador.
 */
export function ChatExportMenu({
  conversaAtualId,
  idsListados,
}: {
  conversaAtualId: string | null
  idsListados: string[]
}) {
  const [gerando, setGerando] = useState(false)

  async function exportar(ids: string[], formato: Formato) {
    if (ids.length === 0) {
      toast.error("Nenhuma conversa para exportar.")
      return
    }
    setGerando(true)
    try {
      const resposta = await exportChatsAction(ids)
      if (!resposta.ok) {
        toast.error(resposta.message)
        return
      }
      if (resposta.conversas.length === 0) {
        toast.error("Nenhuma conversa encontrada para exportar.")
        return
      }
      if (formato === "pdf") exportChatsToPdf(resposta.conversas)
      else exportChatsToJson(resposta.conversas)
      toast.success(`${resposta.conversas.length} conversa(s) exportada(s) em ${formato.toUpperCase()}.`)
    } catch (error) {
      console.error("Falha ao exportar conversas:", error)
      toast.error("Não foi possível gerar o arquivo. Tente novamente.")
    } finally {
      setGerando(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="rounded-full" aria-label="Exportar conversas" title="Exportar conversas" disabled={gerando}>
            <Download className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {conversaAtualId ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Esta conversa</DropdownMenuLabel>
              <DropdownMenuItem disabled={gerando} onClick={() => void exportar([conversaAtualId], "pdf")}>
                <FileType className="size-4" />
                PDF (.pdf)
              </DropdownMenuItem>
              <DropdownMenuItem disabled={gerando} onClick={() => void exportar([conversaAtualId], "json")}>
                <Braces className="size-4" />
                JSON (.json)
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Todas as conversas da lista ({idsListados.length})</DropdownMenuLabel>
          <DropdownMenuItem disabled={gerando || idsListados.length === 0} onClick={() => void exportar(idsListados, "pdf")}>
            <FileType className="size-4" />
            PDF (.pdf)
          </DropdownMenuItem>
          <DropdownMenuItem disabled={gerando || idsListados.length === 0} onClick={() => void exportar(idsListados, "json")}>
            <Braces className="size-4" />
            JSON (.json)
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
