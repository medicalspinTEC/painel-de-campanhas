import { notFound } from "next/navigation"

import { FlowList } from "@/components/features/nocode/flow-list"
import { PageHeader } from "@/components/shared/page-header"
import { listFlows } from "@/services/nocode"
import { getNocodePluginAtivo } from "@/services/settings"

export const metadata = {
  title: "No Code | Painel de Campanhas WhatsApp",
}

export default async function NoCodePage() {
  if (!(await getNocodePluginAtivo())) notFound()

  const fluxos = await listFlows().catch(() => null)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="No Code"
        descricao="Monte fluxos de automação arrastando blocos, sem serviços externos. Receba os eventos da Evolution API e trate as respostas dos leads direto no app."
      />
      <FlowList fluxos={fluxos} />
    </div>
  )
}
