import { ArrowLeft, Folder, Megaphone } from "lucide-react"
import { notFound } from "next/navigation"

import { CampaignCard } from "@/components/features/campaigns/campaign-card"
import { NovaPastaButton, PastaAbertaMenu, PastaCard } from "@/components/features/campaigns/pasta-controles"
import { LinkButton } from "@/components/shared/link-button"
import { PageHeader } from "@/components/shared/page-header"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { listPastas } from "@/services/campaign-pastas"
import { listCampaigns } from "@/services/campaigns"
import { requireSecao } from "@/lib/session"

export const metadata = {
  title: "Campanhas | Painel de Campanhas WhatsApp",
}

export default async function CampanhasPage({
  searchParams,
}: {
  searchParams: Promise<{ pasta?: string }>
}) {
  await requireSecao("campanhas")
  const { pasta: pastaId } = await searchParams
  const [campanhas, pastas] = await Promise.all([listCampaigns(), listPastas()])

  const pastaAberta = pastaId ? pastas.find((p) => p.id === pastaId) : undefined
  if (pastaId && !pastaAberta) notFound()

  // Na lista principal só aparecem as campanhas sem pasta; dentro de uma pasta, só as dela.
  const visiveis = pastaAberta
    ? campanhas.filter((c) => c.pastaId === pastaAberta.id)
    : campanhas.filter((c) => !c.pastaId)
  const ativas = campanhas.filter((c) => c.status === "ativa").length

  return (
    <div className="flex flex-col gap-6">
      {pastaAberta ? (
        <PageHeader
          titulo={pastaAberta.nome}
          descricao={`${visiveis.length} ${visiveis.length === 1 ? "campanha" : "campanhas"} nesta pasta`}
        >
          <LinkButton href="/campanhas" variant="outline">
            <ArrowLeft className="size-4" />
            Todas as campanhas
          </LinkButton>
          <PastaAbertaMenu pasta={pastaAberta} />
          <LinkButton href="/campanhas/nova">Nova campanha</LinkButton>
        </PageHeader>
      ) : (
        <PageHeader
          titulo="Campanhas"
          descricao={`${campanhas.length} campanhas cadastradas · ${ativas} em execução`}
        >
          <NovaPastaButton />
          <LinkButton href="/campanhas/nova">Nova campanha</LinkButton>
        </PageHeader>
      )}

      {!pastaAberta && pastas.length > 0 ? (
        <section className="flex flex-col gap-3" aria-label="Pastas">
          <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Folder className="size-4" />
            Pastas
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {pastas.map((pasta) => (
              <PastaCard key={pasta.id} pasta={pasta} />
            ))}
          </div>
        </section>
      ) : null}

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
      ) : visiveis.length === 0 ? (
        pastaAberta ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Folder />
              </EmptyMedia>
              <EmptyTitle>Pasta vazia</EmptyTitle>
              <EmptyDescription>
                Use o menu “Mover para pasta” em qualquer campanha para trazê-la para cá.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <p className="text-sm text-muted-foreground">Todas as campanhas estão organizadas em pastas.</p>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visiveis.map((campanha) => (
            <CampaignCard key={campanha.id} campanha={campanha} pastas={pastas} />
          ))}
        </div>
      )}
    </div>
  )
}
