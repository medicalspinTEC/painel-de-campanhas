"use client"

import { useActionState, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { createLeadAction, updateLeadAction, type ActionState } from "@/app/actions/leads"
import { CreatableSelectField } from "@/components/shared/creatable-select-field"
import { SelectField, opcoesComExtras } from "@/components/shared/select-field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import {
  LEAD_STATUS_LABEL,
  type LeadStatus,
  type Lead,
} from "@/types"

const estadoInicial: ActionState = { ok: false, message: "" }

const OPCOES_STATUS = (Object.keys(LEAD_STATUS_LABEL) as LeadStatus[]).map((s) => ({
  value: s,
  label: LEAD_STATUS_LABEL[s],
}))

export interface CampanhaOpcao {
  id: string
  nome: string
}

/** Valores de segmentação já cadastrados na base, para reaproveitar como opções. */
export interface ValoresSegmentacao {
  produtos: string[]
  marcas: string[]
  personas: string[]
  regioes: string[]
}

export function LeadFormDialog({
  open,
  onOpenChange,
  lead,
  campanhas,
  valoresExistentes,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  lead?: Lead | null
  campanhas: CampanhaOpcao[]
  valoresExistentes?: ValoresSegmentacao
}) {
  const editando = Boolean(lead)
  const [state, formAction, pending] = useActionState(
    editando ? updateLeadAction : createLeadAction,
    estadoInicial,
  )

  const [produto, setProduto] = useState(lead?.produto ?? "")
  const [marca, setMarca] = useState(lead?.marca ?? "")
  const [persona, setPersona] = useState(lead?.persona ?? "")
  const [regiao, setRegiao] = useState(lead?.regiao ?? "")
  const [status, setStatus] = useState<string>(lead?.status ?? "novo")
  const [notas, setNotas] = useState(lead?.notas ?? "")
  const [campanhasSelecionadas, setCampanhasSelecionadas] = useState<string[]>(() => (lead ? [lead.campanhaId].filter(Boolean) as string[] : []))

  useEffect(() => {
    setProduto(lead?.produto ?? "")
    setMarca(lead?.marca ?? "")
    setPersona(lead?.persona ?? "")
    setRegiao(lead?.regiao ?? "")
    setStatus(lead?.status ?? "novo")
    setNotas(lead?.notas ?? "")
    setCampanhasSelecionadas(lead ? [lead.campanhaId].filter(Boolean) as string[] : [])
  }, [lead])

  useEffect(() => {
    if (!state.message) return
    if (state.ok) {
      toast.success(state.message)
      onOpenChange(false)
    } else {
      toast.error(state.message)
    }
  }, [state, onOpenChange])

  const erros = state.errors ?? {}
  const opcoesCampanha = useMemo(() => [{ value: "none", label: "Sem campanha" }, ...campanhas.map((c) => ({ value: c.id, label: c.nome }))], [campanhas])

  const opcoesProduto = useMemo(
    () => opcoesComExtras(valoresExistentes?.produtos ?? [], lead?.produto),
    [valoresExistentes, lead],
  )
  const opcoesMarca = useMemo(
    () => opcoesComExtras(valoresExistentes?.marcas ?? [], lead?.marca),
    [valoresExistentes, lead],
  )
  const opcoesPersona = useMemo(
    () => opcoesComExtras(valoresExistentes?.personas ?? [], lead?.persona),
    [valoresExistentes, lead],
  )
  const opcoesRegiao = useMemo(
    () => opcoesComExtras(valoresExistentes?.regioes ?? [], lead?.regiao),
    [valoresExistentes, lead],
  )

  function alternarCampanha(campanhaId: string, checked: boolean) {
    setCampanhasSelecionadas((atual) => (checked ? [...atual, campanhaId] : atual.filter((id) => id !== campanhaId)))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar lead" : "Novo lead"}</DialogTitle>
          <DialogDescription>
            Os atributos abaixo definem em quais campanhas o lead pode ser incluído automaticamente.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          {lead ? <input type="hidden" name="id" value={lead.id} /> : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field data-invalid={Boolean(erros.nome)}>
              <FieldLabel htmlFor="nome">Nome</FieldLabel>
              <Input
                id="nome"
                name="nome"
                defaultValue={lead?.nome}
                placeholder="Ana Paula Souza"
                aria-invalid={Boolean(erros.nome)}
              />
              {erros.nome ? <FieldError>{erros.nome}</FieldError> : null}
            </Field>

            <Field data-invalid={Boolean(erros.telefone)}>
              <FieldLabel htmlFor="telefone">Telefone</FieldLabel>
              <Input
                id="telefone"
                name="telefone"
                defaultValue={lead?.telefone}
                placeholder="(11) 98888-7777"
                aria-invalid={Boolean(erros.telefone)}
              />
              {erros.telefone ? <FieldError>{erros.telefone}</FieldError> : null}
            </Field>

            <Field data-invalid={Boolean(erros.produto)}>
              <FieldLabel htmlFor="produto">Produto</FieldLabel>
              <CreatableSelectField
                id="produto"
                name="produto"
                value={produto}
                onValueChange={setProduto}
                opcoes={opcoesProduto}
                placeholder="Selecione o produto"
                buscaPlaceholder="Buscar ou adicionar produto..."
                className="w-full"
                ariaInvalid={Boolean(erros.produto)}
              />
              {erros.produto ? <FieldError>{erros.produto}</FieldError> : null}
            </Field>

            <Field data-invalid={Boolean(erros.marca)}>
              <FieldLabel htmlFor="marca">Marca</FieldLabel>
              <CreatableSelectField
                id="marca"
                name="marca"
                value={marca}
                onValueChange={setMarca}
                opcoes={opcoesMarca}
                placeholder="Selecione a marca"
                buscaPlaceholder="Buscar ou adicionar marca..."
                className="w-full"
                ariaInvalid={Boolean(erros.marca)}
              />
              {erros.marca ? <FieldError>{erros.marca}</FieldError> : null}
            </Field>

            <Field data-invalid={Boolean(erros.persona)}>
              <FieldLabel htmlFor="persona">Persona</FieldLabel>
              <CreatableSelectField
                id="persona"
                name="persona"
                value={persona}
                onValueChange={setPersona}
                opcoes={opcoesPersona}
                placeholder="Selecione a persona"
                buscaPlaceholder="Buscar ou adicionar persona..."
                className="w-full"
                ariaInvalid={Boolean(erros.persona)}
              />
              {erros.persona ? <FieldError>{erros.persona}</FieldError> : null}
            </Field>

            <Field data-invalid={Boolean(erros.regiao)}>
              <FieldLabel htmlFor="regiao">Região</FieldLabel>
              <CreatableSelectField
                id="regiao"
                name="regiao"
                value={regiao}
                onValueChange={setRegiao}
                opcoes={opcoesRegiao}
                placeholder="Selecione a região"
                buscaPlaceholder="Buscar ou adicionar região..."
                className="w-full"
                ariaInvalid={Boolean(erros.regiao)}
              />
              {erros.regiao ? <FieldError>{erros.regiao}</FieldError> : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="status">Status</FieldLabel>
              <SelectField
                id="status"
                name="status"
                value={status}
                onValueChange={setStatus}
                opcoes={OPCOES_STATUS}
                className="w-full"
              />
            </Field>

            <Field className="sm:col-span-2" data-invalid={Boolean(erros.notas)}>
              <FieldLabel htmlFor="notas">Notas</FieldLabel>
              <Textarea
                id="notas"
                name="notas"
                value={notas}
                onChange={(event) => setNotas(event.target.value)}
                placeholder="Observações que aparecem nos detalhes do lead (opcional)."
                rows={3}
                maxLength={5000}
                aria-invalid={Boolean(erros.notas)}
              />
              {erros.notas ? <FieldError>{erros.notas}</FieldError> : null}
            </Field>

            <Field className="sm:col-span-2">
              <FieldLabel>Campanhas</FieldLabel>
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
                {opcoesCampanha.map((opcao) => {
                  if (opcao.value === "none") {
                    return (
                      <label key={opcao.value} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-background/70">
                        <Checkbox
                          checked={campanhasSelecionadas.length === 0}
                          onCheckedChange={(checked) => {
                            setCampanhasSelecionadas(checked ? [] : [])
                          }}
                        />
                        <span className="text-sm">{opcao.label}</span>
                      </label>
                    )
                  }

                  const checked = campanhasSelecionadas.includes(opcao.value)
                  return (
                    <label key={opcao.value} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-background/70">
                      <Checkbox checked={checked} onCheckedChange={(value) => alternarCampanha(opcao.value, Boolean(value))} />
                      <span className="text-sm">{opcao.label}</span>
                    </label>
                  )
                })}
              </div>
              <input type="hidden" name="campanhasIds" value={campanhasSelecionadas.join(",")} />
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              {editando ? "Salvar alterações" : "Cadastrar lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
