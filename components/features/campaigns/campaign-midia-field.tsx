"use client"

import { useRef, useTransition } from "react"
import { FileText, ImageIcon, Paperclip, X } from "lucide-react"
import { toast } from "sonner"

import { uploadMidiaCampanhaAction } from "@/app/actions/campaigns"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

/** Lê a referência `<id>;<tipo>;<mime>;<bytes>;<nome>` só para exibir nome e tamanho (não há prévia). */
function lerReferencia(valor: string | null | undefined): { tipo: string; tamanho: number; nome: string } | null {
  if (!valor) return null
  const partes = valor.split(";")
  if (partes.length < 5) return null
  return { tipo: partes[1], tamanho: Number(partes[3]) || 0, nome: partes.slice(4).join(";") }
}

function formatarTamanho(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Anexo (imagem ou arquivo) de uma mensagem de campanha. Mesmo modelo do chat: o arquivo vai para uma pasta
 * do servidor, não para o banco, e não há pré-visualização — só o nome e o tamanho. O texto da mensagem
 * vira a legenda no WhatsApp.
 */
export function CampaignMidiaField({
  value,
  onChange,
  label = "Anexar imagem ou arquivo",
}: {
  value: string | null | undefined
  onChange: (valor: string | null) => void
  label?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [enviando, startTransition] = useTransition()
  const anexo = lerReferencia(value)

  function escolher(arquivo: File) {
    const dados = new FormData()
    dados.set("arquivo", arquivo)
    startTransition(async () => {
      const res = await uploadMidiaCampanhaAction(dados)
      if (!res.ok || !res.midia) {
        toast.error(res.message)
        return
      }
      onChange(res.midia)
    })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const arquivo = event.target.files?.[0]
          event.target.value = ""
          if (arquivo) escolher(arquivo)
        }}
      />
      {anexo ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-sm">
          {anexo.tipo === "imagem" ? (
            <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <FileText className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate">{anexo.nome}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatarTamanho(anexo.tamanho)}</span>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(null)} aria-label="Remover anexo">
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={enviando}
          onClick={() => inputRef.current?.click()}
        >
          {enviando ? <Spinner /> : <Paperclip className="size-4" />}
          {enviando ? "Enviando arquivo..." : label}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        O arquivo fica guardado no servidor (não no banco), sem pré-visualização. O texto da mensagem vai como legenda
        (máx. 1024 caracteres).
      </p>
    </div>
  )
}
