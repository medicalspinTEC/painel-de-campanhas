"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { adicionarLeadsAoFunilAction, listarFunisParaAdicionarAction } from "@/app/actions/funis"
import { SelectField } from "@/components/shared/select-field"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { lerValorFunil } from "@/lib/funis"
import type { FunilParaAdicionar } from "@/services/funis"

/**
 * Coloca um ou vários leads em um funil de vendas. Usado pelo chat, pelo detalhe do lead e pela aba Leads
 * (os funis são carregados ao abrir, então nenhuma dessas telas precisa carregá-los antes).
 */
export function FunilAdicionarLeadsDialog({
  open,
  onOpenChange,
  leadIds,
  descricao,
  excluirFunilIds = [],
  onAdicionado,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leadIds: string[]
  /** Quem está sendo adicionado (nome do lead ou "12 leads selecionados"). */
  descricao: string
  /** Funis em que o lead já está (só no caso de um lead): não aparecem na lista. */
  excluirFunilIds?: string[]
  onAdicionado?: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [carregando, setCarregando] = useState(false)
  const [funis, setFunis] = useState<FunilParaAdicionar[]>([])
  const [funilId, setFunilId] = useState("")
  const [etapaId, setEtapaId] = useState("")
  const [valor, setValor] = useState("")

  const chaveExcluidos = excluirFunilIds.join(",")

  useEffect(() => {
    if (!open) return
    let cancelado = false
    setCarregando(true)
    setValor("")
    void listarFunisParaAdicionarAction().then((res) => {
      if (cancelado) return
      setCarregando(false)
      if (!res.ok) return void toast.error(res.message)
      const ocultos = new Set(chaveExcluidos ? chaveExcluidos.split(",") : [])
      const lista = res.funis.filter((f) => !ocultos.has(f.id))
      setFunis(lista)
      setFunilId(lista[0]?.id ?? "")
      setEtapaId(lista[0]?.etapas[0]?.id ?? "")
    })
    return () => {
      cancelado = true
    }
  }, [open, chaveExcluidos])

  function trocarFunil(id: string) {
    setFunilId(id)
    setEtapaId(funis.find((f) => f.id === id)?.etapas[0]?.id ?? "")
  }

  const funil = funis.find((f) => f.id === funilId)

  function adicionar() {
    if (!funil) return
    const numero = lerValorFunil(valor)
    if (Number.isNaN(numero)) return void toast.error("Informe um valor válido.")
    startTransition(async () => {
      const res = await adicionarLeadsAoFunilAction(funil.id, leadIds, { etapaId, valor: numero })
      if (!res.ok) return void toast.error(res.message)
      toast.success(res.message)
      onOpenChange(false)
      onAdicionado?.()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar ao funil de vendas</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>

        {carregando ? (
          <div className="flex justify-center py-8">
            <Spinner className="size-5" />
          </div>
        ) : funis.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhum funil disponível. Crie um funil ativo na aba “Funis” do CRM (ou, se o lead já está em todos, não há mais onde adicioná-lo).
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel>Funil</FieldLabel>
              <SelectField value={funilId} onValueChange={trocarFunil} opcoes={funis.map((f) => ({ value: f.id, label: f.nome }))} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>Etapa</FieldLabel>
                <SelectField value={etapaId} onValueChange={setEtapaId} opcoes={(funil?.etapas ?? []).map((e) => ({ value: e.id, label: e.nome }))} />
              </Field>
              <Field>
                <FieldLabel htmlFor="funil-leads-valor">Valor estimado (opcional)</FieldLabel>
                <Input id="funil-leads-valor" value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" />
              </Field>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={adicionar} disabled={pending || carregando || !funil}>
            {pending ? <Spinner /> : null}
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
