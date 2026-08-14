import { LeadsTable } from "@/components/features/leads/leads-table"
import { PageHeader } from "@/components/shared/page-header"
import { listCampaigns } from "@/services/campaigns"
import { listLeads } from "@/services/leads"

export const metadata = {
  title: "Leads | Painel de Campanhas WhatsApp",
  description: "Base de leads segmentada por produto, marca, persona e região.",
}

export default async function LeadsPage() {
  const [leads, campanhas] = await Promise.all([listLeads(), listCampaigns()])

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        titulo="Leads"
        descricao="Base segmentada por produto, marca, persona e região. Selecione leads para movê-los entre campanhas."
      />
      <LeadsTable leads={leads} campanhas={campanhas.map((c) => ({ id: c.id, nome: c.nome }))} />
    </div>
  )
}
