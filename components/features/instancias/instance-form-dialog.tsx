"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"

export function InstanceFormDialog({
  open,
  onOpenChange,
  onCriar,
  pending = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCriar: (dados: { nome: string; numero?: string; descricao?: string }) => void
  pending?: boolean
}) {
  const [nome, setNome] = useState("")
  const [numero, setNumero] = useState("")
  const [descricao, setDescricao] = useState("")

  useEffect(() => {
    if (!open) return
    setNome("")
    setNumero("")
    setDescricao("")
  }, [open])

  const podeSalvar = nome.trim().length > 0

  function salvar() {
    if (!podeSalvar) return
    onCriar({
      nome: nome.trim(),
      numero: numero.trim() || undefined,
      descricao: descricao.trim() || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova instância</DialogTitle>
        <DialogDescription>
          A instância é criada na Evolution API. Após criar, você faz o pareamento pelo QR Code.
        </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <Field>
            <FieldLabel htmlFor="instancia-nome">Nome da instância</FieldLabel>
            <Input
              id="instancia-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="clinica-central"
              autoFocus
            />
            <FieldDescription>
              Identificador único na Evolution. Use letras, números, hífen ou underline — sem espaços ou acentos.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="instancia-numero">Número (opcional)</FieldLabel>
            <Input
              id="instancia-numero"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="+55 11 98888-0000"
            />
            <FieldDescription>O número é confirmado automaticamente após o pareamento.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="instancia-descricao">Descrição (opcional)</FieldLabel>
            <Textarea
              id="instancia-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Para que essa instância será usada?"
              rows={3}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" onClick={salvar} disabled={!podeSalvar || pending}>
            {pending ? <Spinner /> : null}
            Criar e conectar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
