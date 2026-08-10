"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { CalendarClock, Copy, MessageSquare, MoreHorizontal, Pause, Play, Trash2, Users } from "lucide-react"
import { toast } from "sonner"

import {
  deleteCampaignAction,
  duplicateCampaignAction,
  setCampaignStatusAction,
} from "@/app/actions/campaigns"
import { CampaignStatusBadge } from "@/components/shared/status-badges"
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
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { formatDate, formatNumber, formatPercent } from "@/lib/format"
import type { CampaignWithStats } from "@/services/campaigns"

export function CampaignCard({ campanha }: { campanha: CampaignWithStats }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirmar, setConfirmar] = useState(false)

  function alterarStatus(status: "ativa" | "pausada") {
    startTransition(async () => {
      const res = await setCampaignStatusAction(campanha.id, status)
      if (res.ok) toast.success(res.message)
      else toast.error(res.message)
    })
  }

  function duplicar() {
    startTransition(async () => {
      const res = await duplicateCampaignAction(campanha.id)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(res.message)
      if (res.id) router.push(`/campanhas/${res.id}/editar`)
    })
  }

  function excluir() {
    startTransition(async () => {
      const res = await deleteCampaignAction(campanha.id)
      if (res.ok) toast.success(res.message)
      else toast.error(res.message)
      setConfirmar(false)
    })
  }

  const taxa = campanha.taxaResposta

  return (
    <>
      <Card className="gap-4">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-1.5">
              <CampaignStatusBadge status={campanha.status} />
              <CardTitle className="text-base leading-snug">
                <Link href={`/campanhas/${campanha.id}`} className="hover:underline">
                  {campanha.nome}
                </Link>
              </CardTitle>
              <CardDescription className="line-clamp-2">{campanha.descricao ?? "Sem descrição"}</CardDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label={`Ações da campanha ${campanha.nome}`}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem nativeButton={false} render={<Link href={`/campanhas/${campanha.id}/editar`} />}>
                  Editar
                </DropdownMenuItem>
                {campanha.status === "ativa" ? (
                  <DropdownMenuItem onClick={() => alterarStatus("pausada")} disabled={pending}>
                    <Pause className="size-4" />
                    Pausar
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => alterarStatus("ativa")} disabled={pending}>
                    <Play className="size-4" />
                    Ativar
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={duplicar} disabled={pending}>
                  <Copy className="size-4" />
                  Duplicar
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setConfirmar(true)}>
                  <Trash2 className="size-4" />
                  Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2">
            <Metrica icone={<Users className="size-3.5" />} label="Leads" valor={formatNumber(campanha.totalLeads)} />
            <Metrica
              icone={<MessageSquare className="size-3.5" />}
              label="Enviados"
              valor={formatNumber(campanha.mensagensEnviadas)}
            />
            <Metrica
              icone={<CalendarClock className="size-3.5" />}
              label="Cada"
              valor={`${campanha.recorrenciaDias}d`}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Taxa de resposta</span>
              <span className="font-semibold tabular-nums">{formatPercent(taxa)}</span>
            </div>
            <Progress value={taxa} />
          </div>
        </CardContent>

        <CardFooter className="justify-between border-t text-xs text-muted-foreground">
          <span>{campanha.mensagens.length} mensagens na sequência</span>
          <span>{campanha.dataFinal ? `Até ${formatDate(campanha.dataFinal)}` : "Sem data limite"}</span>
        </CardFooter>
      </Card>

      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {campanha.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              Os leads vinculados voltam para o status novo e o histórico de envios é preservado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={excluir} disabled={pending}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function Metrica({ icone, label, valor }: { icone: React.ReactNode; label: string; valor: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-muted/60 px-2.5 py-2">
      <span className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
        {icone}
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{valor}</span>
    </div>
  )
}
