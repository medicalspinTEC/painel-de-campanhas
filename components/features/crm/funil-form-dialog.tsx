"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { atualizarFunilAction, criarFunilAction } from "@/app/actions/funis"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { FUNIL_DESCRICAO_MAX, FUNIL_NOME_MAX, type FunilResumo } from "@/lib/funis"

export function FunilFormDialog({
  open,
  onOpenChange,
  funil,
  aoSalvar,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  funil?: FunilResumo | null
  /** Recebe o id do funil criado (ou editado) para o painel selecioná-lo e recarregar o quadro. */
  aoSalvar: (funilId: string) => void
}) {
  const editando = Boolean(funil)
  const [pending, startTransition] = useTransition()
  const [nome, setNome] = useState("")
  const [descricao, setDescricao] = useState("")
  const [ativo, setAtivo] = useState(true)

  // O diálogo é reaproveitado para criar e editar: recarrega os campos a cada abertura.
  useEffect(() => {
    if (!open) return
    setNome(funil?.nome ?? "")
    setDescricao(funil?.descricao ?? "")
    setAtivo(funil?.ativo ?? true)
  }, [open, funil])

  function salvar() {
    startTransition(async () => {
      const payload = { nome, descricao, ativo }
      if (funil) {
        const resultado = await atualizarFunilAction(funil.id, payload)
        if (!resultado.ok) return void toast.error(resultado.message)
        toast.success(resultado.message)
        onOpenChange(false)
        aoSalvar(funil.id)
        return
      }
      const resultado = await criarFunilAction(payload)
      if (!resultado.ok || !resultado.id) return void toast.error(resultado.message)
      toast.success(resultado.message)
      onOpenChange(false)
      aoSalvar(resultado.id)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar funil" : "Novo funil de vendas"}</DialogTitle>
          <DialogDescription>
            {editando
              ? "Para mudar as etapas, use “Etapas” no quadro do funil."
              : "O funil nasce com etapas padrão (Novo, Qualificação, Proposta, Negociação, Ganho e Perdido) que você pode editar depois."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="funil-nome">Nome</FieldLabel>
            <Input id="funil-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={FUNIL_NOME_MAX} placeholder="Vendas" />
          </Field>

          <Field>
            <FieldLabel htmlFor="funil-descricao">Descrição (opcional)</FieldLabel>
            <Textarea
              id="funil-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              maxLength={FUNIL_DESCRICAO_MAX}
              rows={3}
              placeholder="Para que serve este funil"
            />
          </Field>

          {editando ? (
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <label htmlFor="funil-ativo" className="text-sm font-medium">
                  Funil ativo
                </label>
                <FieldDescription>Inativo continua visível, mas não aceita novos leads nem movimentos.</FieldDescription>
              </div>
              <Switch id="funil-ativo" checked={ativo} onCheckedChange={setAtivo} />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={salvar} disabled={pending}>
            {pending ? <Spinner /> : null}
            {editando ? "Salvar alterações" : "Criar funil"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
