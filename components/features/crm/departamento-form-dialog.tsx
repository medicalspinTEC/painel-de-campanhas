"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { createDepartamentoAction, updateDepartamentoAction } from "@/app/actions/crm"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { DepartamentoItem } from "@/services/crm"

export function DepartamentoFormDialog({
  open,
  onOpenChange,
  departamento,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  departamento?: DepartamentoItem | null
}) {
  const editando = Boolean(departamento)
  const [pending, startTransition] = useTransition()
  const [nome, setNome] = useState("")
  const [descricao, setDescricao] = useState("")
  const [ativo, setAtivo] = useState(true)

  // O diálogo é reaproveitado para criar e editar: recarrega os campos a cada abertura.
  useEffect(() => {
    if (!open) return
    setNome(departamento?.nome ?? "")
    setDescricao(departamento?.descricao ?? "")
    setAtivo(departamento?.ativo ?? true)
  }, [open, departamento])

  function salvar() {
    startTransition(async () => {
      const payload = { nome, descricao, ativo }
      const resultado = departamento
        ? await updateDepartamentoAction(departamento.id, payload)
        : await createDepartamentoAction(payload)
      if (resultado.ok) {
        toast.success(resultado.message)
        onOpenChange(false)
      } else {
        toast.error(resultado.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar departamento" : "Novo departamento"}</DialogTitle>
          <DialogDescription>Departamentos agrupam atendentes e recebem conversas transferidas pelo chat.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="departamento-nome">Nome</FieldLabel>
            <Input
              id="departamento-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={60}
              placeholder="Comercial"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="departamento-descricao">Descrição (opcional)</FieldLabel>
            <Textarea
              id="departamento-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={200}
              rows={3}
              placeholder="Quando transferir para este departamento"
            />
          </Field>

          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <label htmlFor="departamento-ativo" className="text-sm font-medium">
                Departamento ativo
              </label>
              <FieldDescription>Inativo deixa de aparecer na transferência de conversas.</FieldDescription>
            </div>
            <Switch id="departamento-ativo" checked={ativo} onCheckedChange={setAtivo} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={salvar} disabled={pending}>
            {pending ? <Spinner /> : null}
            {editando ? "Salvar alterações" : "Criar departamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
