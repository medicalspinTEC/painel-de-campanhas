import { InstanciasManager } from "@/components/features/instancias/instancias-manager"
import { PageHeader } from "@/components/shared/page-header"
import { fetchEvolutionInstances } from "@/services/evolution"

export const metadata = {
  title: "Instâncias | Painel de Campanhas WhatsApp",
}

export default async function InstanciasPage() {
  const instancias = await fetchEvolutionInstances()

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        titulo="Instâncias"
        descricao="Crie e conecte instâncias de WhatsApp usadas nos disparos. Cada instância é pareada por QR Code e pode ser conectada ou desconectada de forma independente."
      />

      <InstanciasManager instanciasIniciais={instancias} />
    </div>
  )
}
