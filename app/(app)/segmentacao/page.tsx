import { ProdutosManager } from "@/components/features/segmentacao/produtos-manager"
import { PageHeader } from "@/components/shared/page-header"
import { listLeads } from "@/services/leads"
import { listProdutos } from "@/services/produtos"

export const metadata = {
  title: "Segmentação | Painel de Campanhas WhatsApp",
  description: "Cadastre os produtos usados para segmentar leads e campanhas.",
}

export default async function SegmentacaoPage() {
  const [produtos, leads] = await Promise.all([listProdutos(), listLeads()])

  // Quantos leads usam cada produto (por nome), para dar contexto de uso.
  const contagemLeads = leads.reduce<Record<string, number>>((acc, lead) => {
    if (lead.produto) acc[lead.produto] = (acc[lead.produto] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        titulo="Segmentação"
        descricao="Cadastre e gerencie os produtos usados para segmentar leads. Produtos ativos ficam disponíveis como opção ao criar ou editar um lead."
      />
      <ProdutosManager produtos={produtos} contagemLeads={contagemLeads} />
    </div>
  )
}
