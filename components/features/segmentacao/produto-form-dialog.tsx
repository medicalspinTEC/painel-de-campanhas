"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { createProdutoAction, updateProdutoAction } from "@/app/actions/produtos"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { Produto } from "@/services/produtos"

export function ProdutoFormDialog({
  open,
  onOpenChange,
  produto,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  produto?: Produto | null
}) {
  const editando = Boolean(produto)
  const [pending, startTransition] = useTransition()

  const [nome, setNome] = useState("")
  const [descricao, setDescricao] = useState("")
  const [ativo, setAtivo] = useState(true)
  const [erros, setErros] = useState<Record<string, string>>({})

  // O diálogo é montado uma vez e reaproveitado: recarrega os campos ao abrir.
  useEffect(() => {
    if (!open) return
    setNome(produto?.nome ?? "")
    setDescricao(produto?.descricao ?? "")
    setAtivo(produto?.ativo ?? true)
    setErros({})
  }, [open, produto])

  function salvar() {
    startTransition(async () => {
      const payload = { nome, descricao, ativo }
      const resultado = produto
        ? await updateProdutoAction(produto.id, payload)
        : await createProdutoAction(payload)

      if (resultado.ok) {
        toast.success(resultado.message)
        onOpenChange(false)
      } else {
        setErros(resultado.errors ?? {})
        toast.error(resultado.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar produto" : "Novo produto"}</DialogTitle>
          <DialogDescription>
            Produtos ativos aparecem como opção de segmentação ao criar ou editar leads.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field data-invalid={Boolean(erros.nome)}>
            <FieldLabel htmlFor="produto-nome">Nome</FieldLabel>
            <Input
              id="produto-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value.slice(0, 60))}
              placeholder="Consórcio Imobiliário"
              aria-invalid={Boolean(erros.nome)}
            />
            {erros.nome ? <FieldError>{erros.nome}</FieldError> : null}
          </Field>

          <Field data-invalid={Boolean(erros.descricao)}>
            <FieldLabel htmlFor="produto-descricao">Descrição</FieldLabel>
            <Textarea
              id="produto-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Detalhes internos sobre o produto (opcional)."
              rows={3}
              maxLength={280}
              aria-invalid={Boolean(erros.descricao)}
            />
            {erros.descricao ? <FieldError>{erros.descricao}</FieldError> : null}
          </Field>

          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <label htmlFor="produto-ativo" className="text-sm font-medium">
                Produto ativo
              </label>
              <FieldDescription>Desative para escondê-lo das opções de novos leads.</FieldDescription>
            </div>
            <Switch id="produto-ativo" checked={ativo} onCheckedChange={setAtivo} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={salvar} disabled={pending}>
            {pending ? <Spinner /> : null}
            {editando ? "Salvar alterações" : "Cadastrar produto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
