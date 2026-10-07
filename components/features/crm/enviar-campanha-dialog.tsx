"use client"

import { useEffect, useState, useTransition } from "react"
import { Megaphone } from "lucide-react"
import { toast } from "sonner"

import { enviarLeadParaCampanhaAction } from "@/app/actions/crm"
import { SelectField } from "@/components/shared/select-field"
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
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import type { CampanhaAberta } from "@/services/campaigns"

const STATUS_ROTULO: Record<CampanhaAberta["status"], string> = {
  ativa: "ativa",
  pausada: "pausada",
  rascunho: "rascunho",
}

export function EnviarCampanhaDialog({
  open,
  onOpenChange,
  leadId,
  leadNome,
  campanhas,
  campanhasDoLead,
  onEnviado,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leadId: string
  leadNome: string
  campanhas: CampanhaAberta[]
  /** Nomes das campanhas em que o lead já está (só para avisar; quem decide é o servidor). */
  campanhasDoLead: string[]
  onEnviado: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [campanhaId, setCampanhaId] = useState("")
  const [mensagem, setMensagem] = useState("")

  useEffect(() => {
    if (!open) return
    setCampanhaId("")
    setMensagem("")
  }, [open, leadId])

  const campanha = campanhas.find((c) => c.id === campanhaId) ?? null
  const individual = campanha?.tipo === "individual"
  const jaEsta = campanha ? campanhasDoLead.includes(campanha.nome) : false
  const incompleto = !campanha || (individual && !mensagem.trim())

  function enviar() {
    startTransition(async () => {
      const resultado = await enviarLeadParaCampanhaAction(leadId, campanhaId, individual ? mensagem : null)
      if (resultado.ok) {
        toast.success(resultado.message)
        onOpenChange(false)
        onEnviado()
      } else {
        toast.error(resultado.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="size-4 text-primary" />
            Enviar para campanha
          </DialogTitle>
          <DialogDescription>
            {leadNome} entra na campanha escolhida. Se ela estiver ativa, a mensagem inicial sai em seguida.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="enviar-campanha">Campanha</FieldLabel>
            <SelectField
              id="enviar-campanha"
              value={campanhaId}
              onValueChange={setCampanhaId}
              placeholder="Escolha a campanha"
              opcoes={campanhas.map((c) => ({
                value: c.id,
                label: `${c.nome}${c.status !== "ativa" ? ` · ${STATUS_ROTULO[c.status]}` : ""}${c.tipo === "individual" ? " · individual" : ""}`,
              }))}
            />
            {campanhas.length === 0 ? (
              <FieldDescription>Nenhuma campanha aberta. Crie ou reative uma em Campanhas.</FieldDescription>
            ) : null}
            {jaEsta ? <FieldDescription>Este lead já está nesta campanha.</FieldDescription> : null}
            {campanha && campanha.status !== "ativa" ? (
              <FieldDescription>
                A campanha está {STATUS_ROTULO[campanha.status]}: o lead entra, mas nenhuma mensagem sai até ela ser ativada.
              </FieldDescription>
            ) : null}
          </Field>

          {individual ? (
            <Field>
              <FieldLabel htmlFor="enviar-campanha-mensagem">Mensagem para este lead</FieldLabel>
              <Textarea
                id="enviar-campanha-mensagem"
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                rows={4}
                placeholder="Texto que este lead vai receber"
              />
              <FieldDescription>A campanha é individual: cada lead recebe uma mensagem própria.</FieldDescription>
            </Field>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={enviar} disabled={pending || incompleto}>
            {pending ? <Spinner /> : <Megaphone className="size-4" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
