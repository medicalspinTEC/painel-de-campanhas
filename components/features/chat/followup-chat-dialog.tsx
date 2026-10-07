"use client"

import { useCallback, useEffect, useState } from "react"
import { Clock, MessageSquareReply, Send } from "lucide-react"
import { toast } from "sonner"

import { configureFollowUpChatAction, getFollowUpChatAction, sendFollowUpNowAction } from "@/app/actions/chat"
import { SelectField } from "@/components/shared/select-field"
import { textoTempo } from "@/lib/followup-regras"
import { Badge } from "@/components/ui/badge"
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
import { Switch } from "@/components/ui/switch"
import type { FollowUpChatInfo } from "@/services/followup"

/** Valor do select para "sem escolha manual": vale a regra do bot (específico ou aleatório). */
const REGRA_DO_BOT = "__regra__"

function quando(data: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(data))
}

/** Follow-up automático de uma conversa: liga/desliga, escolhe o template e envia na hora. */
export function FollowUpChatDialog({
  open,
  onOpenChange,
  leadId,
  leadNome,
  aoAlterar,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leadId: string
  leadNome: string
  /** Chamado depois de qualquer mudança (para o chat recarregar a lista e o histórico). */
  aoAlterar: () => void
}) {
  const [info, setInfo] = useState<FollowUpChatInfo | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [enviando, setEnviando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const resultado = await getFollowUpChatAction(leadId)
    setCarregando(false)
    if (!resultado.ok) {
      toast.error(resultado.message)
      return
    }
    setInfo(resultado.info)
  }, [leadId])

  useEffect(() => {
    if (!open) return
    setInfo(null)
    void carregar()
  }, [open, carregar])

  async function ajustar(ajustes: { desativado?: boolean; templateId?: string | null }) {
    setSalvando(true)
    const resultado = await configureFollowUpChatAction(leadId, ajustes)
    setSalvando(false)
    if (!resultado.ok) {
      toast.error(resultado.message)
      return
    }
    toast.success(resultado.message)
    await carregar()
    aoAlterar()
  }

  async function enviarAgora() {
    if (!info) return
    setEnviando(true)
    const resultado = await sendFollowUpNowAction(leadId, info.templateId)
    setEnviando(false)
    if (!resultado.ok) {
      toast.error(resultado.message)
      return
    }
    toast.success(resultado.message)
    await carregar()
    aoAlterar()
  }

  const templateEscolhido = info?.templates.find((t) => t.id === info.templateId) ?? null
  // Prévia do que vai sair: o template do chat, ou (sem escolha) a regra do bot.
  const regraTexto = info?.modoTemplate === "especifico" ? "o template específico do bot" : "um template sorteado entre os ativos"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquareReply className="size-4" aria-hidden="true" />
            Follow-up automático
          </DialogTitle>
          <DialogDescription>Conversa com {leadNome}.</DialogDescription>
        </DialogHeader>

        {carregando && !info ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : !info ? (
          <p className="text-sm text-muted-foreground">O departamento desta conversa não tem bot de follow-up.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{info.botNome}</span>
              <Badge variant={info.botAtivo ? "default" : "secondary"}>{info.botAtivo ? "Ligado" : "Desligado"}</Badge>
              <span className="text-xs text-muted-foreground">
                envia após {textoTempo(info.minutosSemResposta)} sem resposta · até {info.maxFollowUps} seguidos
              </span>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <label htmlFor="fu-chat-ativo" className="text-sm font-medium">
                  Follow-up automático neste chat
                </label>
                <FieldDescription>Desligado, o bot não envia nada para este lead.</FieldDescription>
              </div>
              <Switch
                id="fu-chat-ativo"
                checked={!info.desativado}
                disabled={salvando}
                onCheckedChange={(ligado) => void ajustar({ desativado: !ligado })}
              />
            </div>

            <Field>
              <FieldLabel>Template deste chat</FieldLabel>
              <SelectField
                value={info.templateId ?? REGRA_DO_BOT}
                disabled={salvando || info.templates.length === 0}
                onValueChange={(valor) => void ajustar({ templateId: valor === REGRA_DO_BOT ? null : valor })}
                opcoes={[
                  { value: REGRA_DO_BOT, label: info.modoTemplate === "especifico" ? "Padrão do bot (específico)" : "Automático (aleatório)" },
                  ...info.templates.map((t) => ({ value: t.id, label: t.nome })),
                ]}
              />
              <FieldDescription>
                {templateEscolhido ? "Este template será usado em todos os follow-ups deste chat." : `Sem escolha manual, o bot usa ${regraTexto}.`}
              </FieldDescription>
            </Field>

            {templateEscolhido ? (
              <p className="whitespace-pre-line rounded-md border bg-muted/40 p-3 text-sm">{templateEscolhido.texto}</p>
            ) : null}

            <div className="flex flex-col gap-1 rounded-md border p-3 text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <Clock className="size-3.5" aria-hidden="true" />
                {info.proximoEm && !info.desativado
                  ? `Próximo follow-up: ${quando(info.proximoEm)}`
                  : "Nenhum follow-up agendado"}
              </span>
              <span className="text-xs text-muted-foreground">
                {info.motivo ?? "Sai se o lead continuar sem responder até lá."} Enviados desde a última resposta: {info.enviados}/
                {info.maxFollowUps}.
              </span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          {info ? (
            <Button type="button" onClick={() => void enviarAgora()} disabled={enviando || info.templates.length === 0}>
              {enviando ? <Spinner /> : <Send className="size-4" />}
              Enviar follow-up agora
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
