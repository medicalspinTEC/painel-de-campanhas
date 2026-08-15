import { SegmentacaoTabs } from "@/components/features/segmentacao/segmentacao-tabs"
import { PageHeader } from "@/components/shared/page-header"
import { servicoMarcas, servicoPersonas, servicoRegioes } from "@/services/catalogo-segmentacao"
import { listLeads } from "@/services/leads"
import { listProdutos } from "@/services/produtos"

export const metadata = {
  title: "Segmentação | Painel de Campanhas WhatsApp",
  description: "Cadastre produtos, marcas, personas e regiões usados para segmentar leads e campanhas.",
}

/** Conta quantos leads usam cada valor de uma dimensão (por texto). */
function contar<T>(leads: T[], seletor: (lead: T) => string | null | undefined): Record<string, number> {
  return leads.reduce<Record<string, number>>((acc, lead) => {
    const valor = seletor(lead)
    if (valor) acc[valor] = (acc[valor] ?? 0) + 1
    return acc
  }, {})
}

export default async function SegmentacaoPage() {
  const [produtos, marcas, personas, regioes, leads] = await Promise.all([
    listProdutos(),
    servicoMarcas.listar(),
    servicoPersonas.listar(),
    servicoRegioes.listar(),
    listLeads(),
  ])

  const contagens = {
    produtos: contar(leads, (l) => l.produto),
    marcas: contar(leads, (l) => l.marca),
    personas: contar(leads, (l) => l.persona),
    regioes: contar(leads, (l) => l.regiao),
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        titulo="Segmentação"
        descricao="Cadastre e gerencie produtos, marcas, personas e regiões usados para segmentar leads. Itens ativos ficam disponíveis como opção ao criar ou editar um lead."
      />
      <SegmentacaoTabs
        produtos={produtos}
        marcas={marcas}
        personas={personas}
        regioes={regioes}
        contagens={contagens}
      />
    </div>
  )
}
