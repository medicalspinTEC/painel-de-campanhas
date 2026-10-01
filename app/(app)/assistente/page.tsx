import { notFound } from "next/navigation"

import { AssistantChat } from "@/components/features/assistant/assistant-leads"
import { PageHeader } from "@/components/shared/page-header"
import { getAssistentePluginAtivo } from "@/services/settings"

export const metadata = {
  title: "Assistente | Painel de Campanhas WhatsApp",
}

export default async function AssistentePage() {
  if (!(await getAssistentePluginAtivo())) notFound()

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        titulo="Assistente"
        descricao="Consulte leads, KPIs e relatórios em uma conversa determinística, sem IA."
      />
      <AssistantChat />
    </div>
  )
}