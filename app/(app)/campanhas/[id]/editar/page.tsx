import { notFound } from "next/navigation"

import { CampaignEditor } from "@/components/features/campaigns/campaign-editor"
import { PageHeader } from "@/components/shared/page-header"
import { getCampaign } from "@/services/campaigns"
import { listLeads } from "@/services/leads"

export default async function EditarCampanhaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [campanha, leads] = await Promise.all([getCampaign(id), listLeads()])
  if (!campanha) notFound()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader titulo={`Editar ${campanha.nome}`} descricao="Ajuste filtros, recorrência e mensagens da sequência." />
      <CampaignEditor
        campanha={campanha}
        leads={leads.map((l) => ({
          id: l.id,
          nome: l.nome,
          telefone: l.telefone,
          produto: l.produto,
          marca: l.marca,
          persona: l.persona,
          regiao: l.regiao,
          campanhasIds: l.campanhasIds,
        }))}
      />
    </div>
  )
}
