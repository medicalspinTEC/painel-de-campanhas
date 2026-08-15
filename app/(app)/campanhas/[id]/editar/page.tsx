import { notFound } from "next/navigation"

import { CampaignEditor } from "@/components/features/campaigns/campaign-editor"
import { PageHeader } from "@/components/shared/page-header"
import { getCampaign } from "@/services/campaigns"
import { servicoMarcas, servicoPersonas, servicoRegioes } from "@/services/catalogo-segmentacao"
import { listLeads } from "@/services/leads"
import { listNomesProdutosAtivos } from "@/services/produtos"

export default async function EditarCampanhaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [campanha, leads, produtos, marcas, personas, regioes] = await Promise.all([
    getCampaign(id),
    listLeads(),
    listNomesProdutosAtivos(),
    servicoMarcas.listarNomesAtivos(),
    servicoPersonas.listarNomesAtivos(),
    servicoRegioes.listarNomesAtivos(),
  ])
  if (!campanha) notFound()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader titulo={`Editar ${campanha.nome}`} descricao="Ajuste filtros, recorrência e mensagens da sequência." />
      <CampaignEditor
        campanha={campanha}
        produtos={produtos}
        marcas={marcas}
        personas={personas}
        regioes={regioes}
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
