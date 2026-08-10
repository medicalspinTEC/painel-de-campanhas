import { CampaignEditor } from "@/components/features/campaigns/campaign-editor"
import { PageHeader } from "@/components/shared/page-header"
import { listLeads } from "@/services/leads"

export const metadata = {
  title: "Nova campanha",
}

export default async function NovaCampanhaPage() {
  const leads = await listLeads()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Nova campanha"
        descricao="Monte a sequência de follow-up e escolha quem deve receber as mensagens."
      />
      <CampaignEditor
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
