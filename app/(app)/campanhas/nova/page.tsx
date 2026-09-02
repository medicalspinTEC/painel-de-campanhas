import { CampaignEditor } from "@/components/features/campaigns/campaign-editor"
import { PageHeader } from "@/components/shared/page-header"
import { servicoMarcas, servicoPersonas, servicoRegioes } from "@/services/catalogo-segmentacao"
import { listInstanceOptions } from "@/services/evolution"
import { listLeads } from "@/services/leads"
import { listNomesProdutosAtivos } from "@/services/produtos"

export const metadata = {
  title: "Nova campanha",
}

export default async function NovaCampanhaPage() {
  const [leads, produtos, marcas, personas, regioes, instancias] = await Promise.all([
    listLeads(),
    listNomesProdutosAtivos(),
    servicoMarcas.listarNomesAtivos(),
    servicoPersonas.listarNomesAtivos(),
    servicoRegioes.listarNomesAtivos(),
    listInstanceOptions(),
  ])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Nova campanha"
        descricao="Monte a sequência de follow-up e escolha quem deve receber as mensagens."
      />
      <CampaignEditor
        produtos={produtos}
        marcas={marcas}
        personas={personas}
        regioes={regioes}
        instancias={instancias}
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
