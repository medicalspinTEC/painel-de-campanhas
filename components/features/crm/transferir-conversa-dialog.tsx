"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { ArrowRightLeft } from "lucide-react"
import { toast } from "sonner"

import { transferirConversaAction } from "@/app/actions/crm"
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
import type { ChatAtendimento, CrmChatOpcoes } from "@/services/crm"

const NENHUM = "__nenhum__"

export function TransferirConversaDialog({
  open,
  onOpenChange,
  leadId,
  leadNome,
  atual,
  opcoes,
  onTransferido,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leadId: string
  leadNome: string
  atual: ChatAtendimento | null
  opcoes: CrmChatOpcoes
  onTransferido: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [departamentoId, setDepartamentoId] = useState(NENHUM)
  const [atendenteId, setAtendenteId] = useState(NENHUM)
  const [motivo, setMotivo] = useState("")

  // Reaproveitado entre conversas: começa em branco a cada abertura.
  useEffect(() => {
    if (!open) return
    setDepartamentoId(NENHUM)
    setAtendenteId(NENHUM)
    setMotivo("")
  }, [open, leadId])

  // Com departamento escolhido, só aparecem os atendentes dele; sem departamento, todos os ativos.
  const atendentesDisponiveis = useMemo(
    () =>
      departamentoId === NENHUM
        ? opcoes.atendentes
        : opcoes.atendentes.filter((atendente) => atendente.departamentoIds.includes(departamentoId)),
    [departamentoId, opcoes.atendentes],
  )

  function escolherDepartamento(valor: string) {
    setDepartamentoId(valor)
    // Troca de departamento: descarta o atendente se ele não pertence ao novo.
    if (valor !== NENHUM && atendenteId !== NENHUM) {
      const pertence = opcoes.atendentes.find((a) => a.id === atendenteId)?.departamentoIds.includes(valor)
      if (!pertence) setAtendenteId(NENHUM)
    }
  }

  const semDestino = departamentoId === NENHUM && atendenteId === NENHUM

  function transferir() {
    startTransition(async () => {
      const resultado = await transferirConversaAction(leadId, {
        departamentoId: departamentoId === NENHUM ? null : departamentoId,
        atendenteId: atendenteId === NENHUM ? null : atendenteId,
        motivo,
      })
      if (resultado.ok) {
        toast.success(resultado.message)
        onOpenChange(false)
        onTransferido()
      } else {
        toast.error(resultado.message)
      }
    })
  }

  const responsavelAtual = [atual?.departamentoNome, atual?.atendenteNome].filter(Boolean).join(" / ")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="size-4 text-primary" />
            Transferir conversa
          </DialogTitle>
          <DialogDescription>
            Conversa com {leadNome}. Atualmente: {responsavelAtual || "sem responsável"}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="transferir-departamento">Departamento</FieldLabel>
            <SelectField
              id="transferir-departamento"
              value={departamentoId}
              onValueChange={escolherDepartamento}
              opcoes={[
                { value: NENHUM, label: "Sem departamento" },
                ...opcoes.departamentos.map((departamento) => ({ value: departamento.id, label: departamento.nome })),
              ]}
            />
            {opcoes.departamentos.length === 0 ? (
              <FieldDescription>Nenhum departamento ativo. Crie ou ative um em CRM.</FieldDescription>
            ) : null}
          </Field>

          <Field>
            <FieldLabel htmlFor="transferir-atendente">Atendente</FieldLabel>
            <SelectField
              id="transferir-atendente"
              value={atendenteId}
              onValueChange={setAtendenteId}
              opcoes={[
                {
                  value: NENHUM,
                  label: departamentoId === NENHUM ? "Sem atendente" : "Sem atendente (fila do departamento)",
                },
                ...atendentesDisponiveis.map((atendente) => ({
                  value: atendente.id,
                  label: `${atendente.nome}${atendente.role === "admin" ? " · Admin" : ""}`,
                })),
              ]}
            />
            {departamentoId !== NENHUM && atendentesDisponiveis.length === 0 ? (
              <FieldDescription>Nenhum atendente ativo neste departamento.</FieldDescription>
            ) : null}
          </Field>

          <Field>
            <FieldLabel htmlFor="transferir-motivo">Motivo (opcional)</FieldLabel>
            <Textarea
              id="transferir-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Ex.: cliente pediu proposta comercial"
            />
            <FieldDescription>Fica registrado como nota interna na conversa.</FieldDescription>
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={transferir} disabled={pending || semDestino}>
            {pending ? <Spinner /> : <ArrowRightLeft className="size-4" />}
            Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
