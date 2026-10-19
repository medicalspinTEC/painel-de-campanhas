"use client"

import { useEffect, useState, useTransition } from "react"
import { Search } from "lucide-react"
import { toast } from "sonner"

import { adicionarLeadAoFunilAction, buscarLeadsFunilAction } from "@/app/actions/funis"
import { SelectField } from "@/components/shared/select-field"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { lerValorFunil, type FunilResumo } from "@/lib/funis"
import { cn } from "@/lib/utils"

type LeadBusca = { id: string; nome: string; telefone: string }

export function FunilAdicionarLeadDialog({
  open,
  onOpenChange,
  funil,
  aoAdicionar,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  funil: FunilResumo
  aoAdicionar: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [buscando, setBuscando] = useState(false)
  const [termo, setTermo] = useState("")
  const [resultados, setResultados] = useState<LeadBusca[]>([])
  const [escolhido, setEscolhido] = useState<LeadBusca | null>(null)
  const [etapaId, setEtapaId] = useState("")
  const [valor, setValor] = useState("")

  useEffect(() => {
    if (!open) return
    setTermo("")
    setResultados([])
    setEscolhido(null)
    setEtapaId(funil.etapas[0]?.id ?? "")
    setValor("")
  }, [open, funil])

  // Busca com espera curta para não disparar uma consulta a cada tecla.
  useEffect(() => {
    if (!open) return
    let cancelado = false
    setBuscando(true)
    const timer = window.setTimeout(async () => {
      const res = await buscarLeadsFunilAction(funil.id, termo)
      if (cancelado) return
      setBuscando(false)
      if (res.ok) setResultados(res.leads)
      else toast.error(res.message)
    }, 250)
    return () => {
      cancelado = true
      window.clearTimeout(timer)
    }
  }, [open, termo, funil.id])

  function adicionar() {
    if (!escolhido) return
    const numero = lerValorFunil(valor)
    if (Number.isNaN(numero)) return void toast.error("Informe um valor válido.")
    startTransition(async () => {
      const res = await adicionarLeadAoFunilAction(funil.id, escolhido.id, { etapaId, valor: numero })
      if (!res.ok) return void toast.error(res.message)
      toast.success(res.message)
      onOpenChange(false)
      aoAdicionar()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar lead ao funil</DialogTitle>
          <DialogDescription>Busque por nome ou telefone. Só aparecem leads que ainda não estão neste funil.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Buscar lead" aria-label="Buscar lead" className="pl-8" />
          </div>

          <ul className="flex max-h-52 flex-col gap-1 overflow-y-auto" aria-busy={buscando}>
            {resultados.map((lead) => (
              <li key={lead.id}>
                <button
                  type="button"
                  onClick={() => setEscolhido(lead)}
                  className={cn(
                    "flex w-full flex-col rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                    escolhido?.id === lead.id && "border-primary bg-primary/5",
                  )}
                >
                  <span className="truncate font-medium">{lead.nome}</span>
                  <span className="text-xs text-muted-foreground">{lead.telefone}</span>
                </button>
              </li>
            ))}
            {!buscando && resultados.length === 0 ? (
              <li className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">Nenhum lead encontrado.</li>
            ) : null}
          </ul>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>Etapa inicial</FieldLabel>
              <SelectField value={etapaId} onValueChange={setEtapaId} opcoes={funil.etapas.map((e) => ({ value: e.id, label: e.nome }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="funil-valor-novo">Valor estimado (opcional)</FieldLabel>
              <Input id="funil-valor-novo" value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={adicionar} disabled={pending || !escolhido}>
            {pending ? <Spinner /> : null}
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
