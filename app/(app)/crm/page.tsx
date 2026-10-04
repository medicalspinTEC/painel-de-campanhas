import { notFound } from "next/navigation"

import { CrmManager } from "@/components/features/crm/crm-manager"
import { PageHeader } from "@/components/shared/page-header"
import { requirePoder } from "@/lib/session"
import { getCrmData } from "@/services/crm"
import { getChatPluginAtivo, getCrmPluginAtivo } from "@/services/settings"

export const metadata = {
  title: "CRM | Painel de Campanhas WhatsApp",
}

export default async function CrmPage() {
  const ator = await requirePoder("crm_gerenciar")
  if (!(await getCrmPluginAtivo())) notFound()

  const [dados, chatAtivo] = await Promise.all([getCrmData(ator), getChatPluginAtivo()])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="CRM"
        descricao="Organize o atendimento em departamentos e atendentes. Com o plugin Chat ativo, as conversas podem ser transferidas entre eles."
      />
      <CrmManager dados={dados} chatAtivo={chatAtivo} usuarioAtualId={ator.id} ehRoot={ator.role === "root"} />
    </div>
  )
}
