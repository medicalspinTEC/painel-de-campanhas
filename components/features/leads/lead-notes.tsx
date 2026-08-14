"use client"

import { useState, useTransition } from "react"
import { NotebookPen, Pencil } from "lucide-react"
import { toast } from "sonner"

import { updateLeadNotesAction } from "@/app/actions/leads"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Textarea } from "@/components/ui/textarea"

const LIMITE = 5000

export function LeadNotes({ leadId, notas }: { leadId: string; notas: string | null }) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(notas ?? "")
  const [pendente, iniciar] = useTransition()

  function abrirEdicao() {
    setValor(notas ?? "")
    setEditando(true)
  }

  function cancelar() {
    setValor(notas ?? "")
    setEditando(false)
  }

  function salvar() {
    iniciar(async () => {
      const resultado = await updateLeadNotesAction(leadId, valor)
      if (resultado.ok) {
        toast.success(resultado.message)
        setEditando(false)
      } else {
        toast.error(resultado.message)
      }
    })
  }

  if (!editando) {
    if (!notas) {
      return (
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <NotebookPen />
            </EmptyMedia>
            <EmptyTitle>Sem anotações</EmptyTitle>
            <EmptyDescription>Registre observações sobre o lead. As notas são opcionais e podem ser editadas a qualquer momento.</EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" size="sm" onClick={abrirEdicao}>
            <Pencil className="size-4" />
            Adicionar nota
          </Button>
        </Empty>
      )
    }

    return (
      <div className="flex flex-col gap-3">
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{notas}</p>
        <Button variant="outline" size="sm" className="w-fit" onClick={abrirEdicao}>
          <Pencil className="size-4" />
          Editar nota
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        autoFocus
        value={valor}
        maxLength={LIMITE}
        onChange={(event) => setValor(event.target.value)}
        placeholder="Escreva uma anotação sobre este lead…"
        className="min-h-32 resize-y"
        aria-label="Anotações do lead"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs tabular-nums text-muted-foreground">
          {valor.length}/{LIMITE}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={cancelar} disabled={pendente}>
            Cancelar
          </Button>
          <Button size="sm" onClick={salvar} disabled={pendente}>
            {pendente ? "Salvando…" : "Salvar nota"}
          </Button>
        </div>
      </div>
    </div>
  )
}
