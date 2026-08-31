"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

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
import type { CatalogoActionResult } from "@/app/actions/catalogo-segmentacao"
import type { ItemCatalogo, ItemCatalogoInput } from "@/services/catalogo-segmentacao"

/**
 * Diálogo genérico de cadastro/edição para um item de catálogo de segmentação
 * (marca, persona ou região). Segue o mesmo comportamento do formulário de
 * produtos: o diálogo é montado uma vez e recarrega os campos ao abrir.
 */
export function CatalogoFormDialog({
  open,
  onOpenChange,
  item,
  singular,
  descricaoExemplo,
  onCreate,
  onUpdate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item?: ItemCatalogo | null
  /** Rótulo no singular, minúsculo, ex.: "marca". */
  singular: string
  /** Placeholder do campo de nome, ex.: "NovaVida". */
  descricaoExemplo: string
  onCreate: (input: ItemCatalogoInput) => Promise<CatalogoActionResult>
  onUpdate: (id: string, input: ItemCatalogoInput) => Promise<CatalogoActionResult>
}) {
  const editando = Boolean(item)
  const [pending, startTransition] = useTransition()

  const [nome, setNome] = useState("")
  const [descricao, setDescricao] = useState("")
  const [idImportacao, setIdImportacao] = useState("")
  const [ativo, setAtivo] = useState(true)
  const [erros, setErros] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setNome(item?.nome ?? "")
    setDescricao(item?.descricao ?? "")
    setIdImportacao(item?.idImportacao ?? "")
    setAtivo(item?.ativo ?? true)
    setErros({})
  }, [open, item])

  function salvar() {
    startTransition(async () => {
      const payload = { nome, descricao, ativo, idImportacao }
      const resultado = item ? await onUpdate(item.id, payload) : await onCreate(payload)

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
          <DialogTitle>
            {editando ? `Editar ${singular}` : `Nova ${singular}`}
          </DialogTitle>
          <DialogDescription>
            Itens ativos aparecem como opção de segmentação ao criar ou editar leads.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field data-invalid={Boolean(erros.nome)}>
            <FieldLabel htmlFor="catalogo-nome">Nome</FieldLabel>
            <Input
              id="catalogo-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value.slice(0, 60))}
              placeholder={descricaoExemplo}
              aria-invalid={Boolean(erros.nome)}
            />
            {erros.nome ? <FieldError>{erros.nome}</FieldError> : null}
          </Field>

          <Field data-invalid={Boolean(erros.descricao)}>
            <FieldLabel htmlFor="catalogo-descricao">Descrição</FieldLabel>
            <Textarea
              id="catalogo-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Detalhes internos (opcional)."
              rows={3}
              maxLength={280}
              aria-invalid={Boolean(erros.descricao)}
            />
            {erros.descricao ? <FieldError>{erros.descricao}</FieldError> : null}
          </Field>

          <Field data-invalid={Boolean(erros.idImportacao)}>
            <FieldLabel htmlFor="catalogo-id-importacao">ID de importação (opcional)</FieldLabel>
            <Input
              id="catalogo-id-importacao"
              value={idImportacao}
              onChange={(e) => setIdImportacao(e.target.value.slice(0, 60))}
              placeholder="Ex.: SEG-01"
              aria-invalid={Boolean(erros.idImportacao)}
            />
            <FieldDescription>
              Use este código na planilha para identificar o item sem precisar digitar o nome exato.
            </FieldDescription>
            {erros.idImportacao ? <FieldError>{erros.idImportacao}</FieldError> : null}
          </Field>

          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <label htmlFor="catalogo-ativo" className="text-sm font-medium">
                Item ativo
              </label>
              <FieldDescription>Desative para escondê-lo das opções de novos leads.</FieldDescription>
            </div>
            <Switch id="catalogo-ativo" checked={ativo} onCheckedChange={setAtivo} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={salvar} disabled={pending}>
            {pending ? <Spinner /> : null}
            {editando ? "Salvar alterações" : `Cadastrar ${singular}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
