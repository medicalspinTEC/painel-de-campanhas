import { Megaphone } from "lucide-react"

import { CampaignCard } from "@/components/features/campaigns/campaign-card"
import { LinkButton } from "@/components/shared/link-button"
import { PageHeader } from "@/components/shared/page-header"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { listCampaigns } from "@/services/campaigns"

export const metadata = {
  title: "Campanhas",
}

export default async function CampanhasPage() {
  const campanhas = await listCampaigns()
  const ativas = campanhas.filter((c) => c.status === "ativa").length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Campanhas"
        descricao={`${campanhas.length} campanhas cadastradas · ${ativas} em execução`}
      >
        <LinkButton href="/campanhas/nova">Nova campanha</LinkButton>
      </PageHeader>

      {campanhas.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Megaphone />
            </EmptyMedia>
            <EmptyTitle>Nenhuma campanha ainda</EmptyTitle>
            <EmptyDescription>
              Crie uma sequência de mensagens e defina os filtros de público para começar a nutrir os leads.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <LinkButton href="/campanhas/nova">Criar primeira campanha</LinkButton>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {campanhas.map((campanha) => (
            <CampaignCard key={campanha.id} campanha={campanha} />
          ))}
        </div>
      )}
    </div>
  )
}
