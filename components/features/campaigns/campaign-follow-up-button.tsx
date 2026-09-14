"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { UserRoundPlus } from "lucide-react"
import { toast } from "sonner"

import { createFollowUpCampaignAction } from "@/app/actions/campaigns"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { formatNumber } from "@/lib/format"

/**
 * Só faz sentido mostrar este botão quando a campanha já está encerrada e há
 * pelo menos um lead que saiu dela sem responder (ver `saidosSemResponder` /
 * `getCampaignFormerLeads`, exibidos na tabela "Saíram da campanha sem
 * responder"). A criação em si acontece em `createFollowUpCampaignAction`.
 */
export function CampaignFollowUpButton({ campanhaId, totalSaidos }: { campanhaId: string; totalSaidos: number }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function criar() {
    startTransition(async () => {
      const res = await createFollowUpCampaignAction(campanhaId)
      if (!res.ok) {
        toast.error(res.message)
        return
      }
      toast.success(res.message)
      if (res.id) router.push(`/campanhas/${res.id}/editar`)
    })
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="outline" disabled={pending}>
            <UserRoundPlus className="size-4" />
            Nova campanha com quem não respondeu
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Criar campanha com quem não respondeu?</AlertDialogTitle>
          <AlertDialogDescription>
            {formatNumber(totalSaidos)} {totalSaidos === 1 ? "lead que não respondeu será" : "leads que não responderam serão"}{" "}
            copiados para uma nova campanha, criada como rascunho com a mesma sequência de mensagens. Nada é
            enviado agora — você revisa e ativa quando quiser.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={criar} disabled={pending}>
            {pending ? "Criando…" : "Criar campanha"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
