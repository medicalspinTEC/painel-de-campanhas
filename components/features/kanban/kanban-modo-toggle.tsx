"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { Megaphone, Users } from "lucide-react"

import { SelectField, type OpcaoSelect } from "@/components/shared/select-field"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { KanbanCampanha } from "@/services/kanban"
import { CAMPAIGN_STATUS_LABEL } from "@/types"

/**
 * Alterna o Kanban entre os dois modos:
 *  - "Leads": colunas = status do lead (comportamento de sempre);
 *  - "Campanha": o usuário escolhe uma campanha e as colunas viram as etapas da sequência dela.
 * O modo vive na URL (`/kanban?campanha=<id>`), então dá para atualizar a página, compartilhar o link
 * e abrir direto da tela de detalhes da campanha.
 */
export function KanbanModoToggle({
  campanhas,
  campanhaAtualId,
}: {
  campanhas: KanbanCampanha[]
  campanhaAtualId: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const modoCampanha = campanhaAtualId !== null

  const opcoes: OpcaoSelect[] = campanhas.map((campanha) => ({
    value: campanha.id,
    label: `${campanha.nome} · ${CAMPAIGN_STATUS_LABEL[campanha.status].toLowerCase()}`,
  }))

  return (
    <div className="flex w-full flex-wrap items-center gap-2 md:w-auto" role="group" aria-label="Modo do Kanban">
      <Link
        href="/kanban"
        aria-current={modoCampanha ? undefined : "page"}
        className={cn(buttonVariants({ variant: modoCampanha ? "outline" : "default", size: "default" }))}
      >
        <Users className="size-4" aria-hidden />
        Leads
      </Link>

      <div className="flex min-w-0 flex-1 items-center gap-2 md:flex-none">
        <Megaphone
          className={cn("size-4 shrink-0", modoCampanha ? "text-primary" : "text-muted-foreground")}
          aria-hidden
        />
        <SelectField
          value={campanhaAtualId ?? ""}
          onValueChange={(id) => {
            if (!id || id === campanhaAtualId) return
            startTransition(() => router.push(`/kanban?campanha=${encodeURIComponent(id)}`))
          }}
          opcoes={opcoes}
          placeholder={opcoes.length ? "Gerir uma campanha" : "Nenhuma campanha"}
          disabled={opcoes.length === 0 || pending}
          className="w-full md:w-64"
        />
      </div>
    </div>
  )
}
