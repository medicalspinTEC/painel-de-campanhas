"use client"

import { useState, useTransition } from "react"
import { CalendarClock, MessageSquarePlus, Send } from "lucide-react"
import { toast } from "sonner"

import { sendLeadsMessageAction } from "@/app/actions/leads"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SelectField, type OpcaoSelect } from "@/components/shared/select-field"
import { Textarea } from "@/components/ui/textarea"
import { formatNumber } from "@/lib/format"
import type { EvolutionInstanceState, InstanceOption } from "@/services/evolution"

const LIMITE = 4096

/** Valor usado no seletor para "sem instância escolhida" (cai na padrão do ambiente). */
const INSTANCIA_PADRAO = "__padrao__"

const ESTADO_INSTANCIA_LABEL: Record<EvolutionInstanceState, string> = {
  conectado: "conectado",
  conectando: "conectando",
  desconectado: "desconectado",
}

/**
 * Mesma mecânica do `LeadMessageDialog`, mas para vários leads de uma vez:
 * usado na barra de seleção em massa da tabela de leads. Cada lead recebe o
 * mesmo texto (com `{{primeiro_nome}}` resolvido individualmente) fora da
 * sequência de qualquer campanha.
 */
export function LeadsBulkMessageDialog({
  leadIds,
  instancias,
  onEnviado,
}: {
  leadIds: string[]
  instancias: InstanceOption[]
  /** Chamado após um envio com pelo menos um sucesso (ex.: para limpar a seleção). */
  onEnviado?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [texto, setTexto] = useState("")
  const [instancia, setInstancia] = useState<string>(INSTANCIA_PADRAO)
  const [agendadoPara, setAgendadoPara] = useState("")
  const [pendente, iniciar] = useTransition()

  const opcoesInstancia: OpcaoSelect[] = [
    { value: INSTANCIA_PADRAO, label: "Padrão do ambiente" },
    ...instancias.map((i) => ({ value: i.nome, label: `${i.nome} · ${ESTADO_INSTANCIA_LABEL[i.estado]}` })),
  ]

  function fechar(next: boolean) {
    if (pendente) return
    setOpen(next)
    if (!next) {
      setTexto("")
      setAgendadoPara("")
    }
  }

  function enviar() {
    const textoLimpo = texto.trim()
    if (!textoLimpo || leadIds.length === 0) return

    iniciar(async () => {
      const resultado = await sendLeadsMessageAction(
        leadIds,
        textoLimpo,
        instancia === INSTANCIA_PADRAO ? null : instancia,
        agendadoPara || null,
      )
      if (resultado.ok) {
        toast.success(resultado.message)
        setTexto("")
        setAgendadoPara("")
        setOpen(false)
        onEnviado?.()
      } else {
        toast.error(resultado.message)
      }
    })
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={leadIds.length === 0}>
        <MessageSquarePlus className="size-4" />
        Enviar mensagem
      </Button>

      <Dialog open={open} onOpenChange={fechar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar mensagem para {formatNumber(leadIds.length)} lead(s)</DialogTitle>
            <DialogDescription>
              Mensagem avulsa, enviada uma única vez para cada lead selecionado e fora da sequência de qualquer
              campanha. Use {"{{primeiro_nome}}"} para personalizar o texto.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {instancias.length > 0 ? (
              <SelectField
                value={instancia}
                onValueChange={setInstancia}
                opcoes={opcoesInstancia}
                className="w-full"
              />
            ) : null}
            <Textarea
              autoFocus
              value={texto}
              maxLength={LIMITE}
              onChange={(event) => setTexto(event.target.value)}
              placeholder="Olá {{primeiro_nome}}, tudo bem?"
              className="min-h-32 resize-y"
              aria-label="Mensagem para os leads selecionados"
              disabled={pendente}
            />
            <label className="flex items-center gap-2 text-sm font-medium">
              <CalendarClock className="size-4" />
              <span>Agendar para</span>
              <input
                type="datetime-local"
                value={agendadoPara}
                min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                onChange={(event) => setAgendadoPara(event.target.value)}
                className="ml-auto rounded-md border bg-background px-2 py-1 text-sm font-normal"
                disabled={pendente}
              />
            </label>
            <span className="text-right text-xs tabular-nums text-muted-foreground">
              {texto.length}/{LIMITE}
            </span>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => fechar(false)} disabled={pendente}>
              Cancelar
            </Button>
            <Button onClick={enviar} disabled={pendente || !texto.trim()}>
              <Send className="size-4" />
              {pendente ? "Processando…" : agendadoPara ? "Agendar mensagens" : `Enviar para ${formatNumber(leadIds.length)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
