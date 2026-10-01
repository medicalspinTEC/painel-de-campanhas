"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

/** Limite do texto da resposta (o mesmo das mensagens individuais). */
export const LIMITE_RESPOSTA_LEAD = 4096

/**
 * Modal exibido ao marcar manualmente um lead como "Respondeu": a equipe pode
 * digitar o que o lead respondeu para registrar no histórico (opcional).
 * Compartilhado entre a aba Leads e o Kanban para os dois se comportarem igual.
 *
 * Abre quando `leadNome` não é nulo. `onConfirmar` recebe o texto já sem
 * espaços nas pontas, ou `undefined` quando nada foi digitado.
 */
export function LeadRespostaDialog({
  leadNome,
  pendente = false,
  onConfirmar,
  onCancelar,
}: {
  leadNome: string | null
  pendente?: boolean
  onConfirmar: (resposta: string | undefined) => void
  onCancelar: () => void
}) {
  const aberto = leadNome !== null
  const [texto, setTexto] = useState("")
  const [abertoAntes, setAbertoAntes] = useState(false)

  // Cada abertura começa com o campo vazio.
  if (aberto !== abertoAntes) {
    setAbertoAntes(aberto)
    if (aberto) setTexto("")
  }

  function confirmar() {
    const limpo = texto.trim()
    onConfirmar(limpo.length > 0 ? limpo : undefined)
  }

  return (
    <Dialog open={aberto} onOpenChange={(proximo) => !proximo && onCancelar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar {leadNome} como respondido</DialogTitle>
          <DialogDescription>
            O lead sai da campanha automaticamente. Se quiser, digite o que ele respondeu para registrar no
            histórico — é opcional.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          placeholder="O que o lead respondeu? (opcional)"
          className="min-h-24 resize-y"
          maxLength={LIMITE_RESPOSTA_LEAD}
          aria-label="Resposta do lead"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onCancelar} disabled={pendente}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={pendente}>
            {pendente ? "Salvando…" : "Marcar como respondido"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
