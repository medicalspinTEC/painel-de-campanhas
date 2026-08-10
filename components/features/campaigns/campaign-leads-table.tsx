"use client"

import Link from "next/link"
import { useEffect, useState, useTransition } from "react"
import { RotateCw, SkipForward } from "lucide-react"
import { toast } from "sonner"

import { skipCampaignMessageAction } from "@/app/actions/campaigns"
import { LeadStatusBadge } from "@/components/shared/status-badges"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate } from "@/lib/format"
import type { LeadStatus } from "@/types"

export interface CampaignLeadItem {
  id: string
  nome: string
  produto: string
  status: LeadStatus
  mensagensEnviadas: number
  ultimoContato: string | null
  proximaMensagemEm: string | null
  aguardandoRecorrencia: boolean
  temMensagens: boolean
}

/** Formata o tempo restante até uma data futura de forma legível. */
function formatarTempoAte(iso: string | null): string {
  if (!iso) return "—"
  const diffMs = new Date(iso).getTime() - Date.now()
  if (diffMs <= 0) return "agora"

  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 60) return `em ${diffMin} min`

  const diffHoras = Math.floor(diffMin / 60)
  const minutosRestantes = diffMin % 60
  if (diffHoras < 24) {
    return minutosRestantes > 0 ? `em ${diffHoras}h ${minutosRestantes}min` : `em ${diffHoras}h`
  }

  const diffDias = Math.floor(diffHoras / 24)
  const horasRestantes = diffHoras % 24
  return horasRestantes > 0 ? `em ${diffDias}d ${horasRestantes}h` : `em ${diffDias}d`
}

/** Contador que atualiza a cada minuto para refletir a contagem regressiva. */
function Countdown({ iso, aguardandoRecorrencia }: { iso: string | null; aguardandoRecorrencia: boolean }) {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!iso) return
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [iso])

  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      {aguardandoRecorrencia ? (
        <Badge variant="secondary" className="gap-1 text-xs font-normal">
          <RotateCw className="size-3" aria-hidden />
          recorrência
        </Badge>
      ) : null}
      <span className="tabular-nums">{formatarTempoAte(iso)}</span>
    </span>
  )
}

export function CampaignLeadsTable({
  campanhaId,
  leads,
}: {
  campanhaId: string
  leads: CampaignLeadItem[]
}) {
  const [pending, startTransition] = useTransition()
  const [alvo, setAlvo] = useState<CampaignLeadItem | null>(null)
  const [enviandoId, setEnviandoId] = useState<string | null>(null)

  if (leads.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nenhum lead vinculado. Ajuste os filtros ou atribua manualmente na página de leads.
      </p>
    )
  }

  function confirmarPular() {
    if (!alvo) return
    const lead = alvo
    setEnviandoId(lead.id)
    startTransition(async () => {
      const res = await skipCampaignMessageAction(lead.id, campanhaId)
      if (res.ok) {
        toast.success(`${lead.nome}: ${res.message}`)
      } else {
        toast.error(`${lead.nome}: ${res.message}`)
      }
      setEnviandoId(null)
      setAlvo(null)
    })
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Lead</TableHead>
            <TableHead>Produto</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Mensagens</TableHead>
            <TableHead className="text-right">Próxima mensagem</TableHead>
            <TableHead className="text-right">Último contato</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((lead) => (
            <TableRow key={lead.id}>
              <TableCell>
                <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
                  {lead.nome}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{lead.produto}</TableCell>
              <TableCell>
                <LeadStatusBadge status={lead.status} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{lead.mensagensEnviadas}</TableCell>
              <TableCell className="text-right text-muted-foreground">
                <Countdown iso={lead.proximaMensagemEm} aguardandoRecorrencia={lead.aguardandoRecorrencia} />
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {lead.ultimoContato ? formatDate(lead.ultimoContato) : "—"}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAlvo(lead)}
                  disabled={!lead.temMensagens || pending}
                  aria-label={`Pular para a próxima mensagem de ${lead.nome}`}
                >
                  {enviandoId === lead.id ? (
                    <Spinner className="size-4" />
                  ) : (
                    <SkipForward className="size-4" />
                  )}
                  Pular
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AlertDialog open={Boolean(alvo)} onOpenChange={(aberto) => !aberto && !pending && setAlvo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pular para a próxima mensagem?</AlertDialogTitle>
            <AlertDialogDescription>
              {alvo?.aguardandoRecorrencia
                ? `${alvo?.nome} já recebeu toda a sequência. O ciclo será reiniciado e a primeira mensagem enviada agora.`
                : `A próxima mensagem da sequência será enviada agora para ${alvo?.nome} e o contador será reiniciado.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarPular} disabled={pending}>
              {pending ? "Enviando…" : "Enviar agora"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
