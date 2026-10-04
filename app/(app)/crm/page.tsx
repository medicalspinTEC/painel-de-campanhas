import { notFound } from "next/navigation"

import { CrmManager } from "@/components/features/crm/crm-manager"
import { PageHeader } from "@/components/shared/page-header"
import { requireAdminPage } from "@/lib/session"
import { getCrmData } from "@/services/crm"
import { getChatPluginAtivo, getCrmPluginAtivo } from "@/services/settings"

export const metadata = {
  title: "CRM | Painel de Campanhas WhatsApp",
}

export default async function CrmPage() {
  const admin = await requireAdminPage()
  if (!(await getCrmPluginAtivo())) notFound()

  const [dados, chatAtivo] = await Promise.all([getCrmData(), getChatPluginAtivo()])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="CRM"
        descricao="Organize o atendimento em departamentos e atendentes. Com o plugin Chat ativo, as conversas podem ser transferidas entre eles."
      />
      <CrmManager dados={dados} chatAtivo={chatAtivo} usuarioAtualId={admin.id} />
    </div>
  )
}
