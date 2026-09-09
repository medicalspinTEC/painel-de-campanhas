"use client"

import { useState, useTransition } from "react"
import { MessageSquarePlus, Send } from "lucide-react"
import { toast } from "sonner"

import { sendLeadMessageAction } from "@/app/actions/leads"
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
import type { EvolutionInstanceState, InstanceOption } from "@/services/evolution"

const LIMITE = 4096

/** Valor usado no seletor para "sem instância escolhida" (cai na padrão do ambiente). */
const INSTANCIA_PADRAO = "__padrao__"

const ESTADO_INSTANCIA_LABEL: Record<EvolutionInstanceState, string> = {
  conectado: "conectado",
  conectando: "conectando",
  desconectado: "desconectado",
}

export function LeadMessageDialog({
  leadId,
  leadNome,
  instancias,
}: {
  leadId: string
  leadNome: string
  instancias: InstanceOption[]
}) {
  const [open, setOpen] = useState(false)
  const [texto, setTexto] = useState("")
  const [instancia, setInstancia] = useState<string>(INSTANCIA_PADRAO)
  const [pendente, iniciar] = useTransition()

  const opcoesInstancia: OpcaoSelect[] = [
    { value: INSTANCIA_PADRAO, label: "Padrão do ambiente" },
    ...instancias.map((i) => ({ value: i.nome, label: `${i.nome} · ${ESTADO_INSTANCIA_LABEL[i.estado]}` })),
  ]

  function fechar(next: boolean) {
    if (pendente) return
    setOpen(next)
    if (!next) setTexto("")
  }

  function enviar() {
    const textoLimpo = texto.trim()
    if (!textoLimpo) return

    iniciar(async () => {
      const resultado = await sendLeadMessageAction(
        leadId,
        textoLimpo,
        instancia === INSTANCIA_PADRAO ? null : instancia,
      )
      if (resultado.ok) {
        toast.success(resultado.message)
        setTexto("")
        setOpen(false)
      } else {
        toast.error(resultado.message)
      }
    })
  }

  return (
    <>
      <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
        <MessageSquarePlus className="size-4" />
        Enviar mensagem
      </Button>

      <Dialog open={open} onOpenChange={fechar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar mensagem para {leadNome}</DialogTitle>
            <DialogDescription>
              Mensagem avulsa, enviada uma única vez e fora da sequência de qualquer campanha. Use{" "}
              {"{{primeiro_nome}}"} para personalizar o texto.
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
              aria-label="Mensagem para o lead"
              disabled={pendente}
            />
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
              {pendente ? "Enviando…" : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
