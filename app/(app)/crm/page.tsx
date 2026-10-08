import { notFound } from "next/navigation"

import { CrmManager } from "@/components/features/crm/crm-manager"
import { PageHeader } from "@/components/shared/page-header"
import { podeAcessar } from "@/lib/permissoes"
import { requirePoder } from "@/lib/session"
import { getCrmData } from "@/services/crm"
import { listarFollowUpBots } from "@/services/followup"
import { getChatPluginAtivo, getCrmPluginAtivo, getNocodePluginAtivo } from "@/services/settings"

export const metadata = {
  title: "CRM | Painel de Campanhas WhatsApp",
}

export default async function CrmPage() {
  const ator = await requirePoder("crm_gerenciar")
  if (!(await getCrmPluginAtivo())) notFound()

  const [dados, chatAtivo, nocodeAtivo, followUpBots] = await Promise.all([
    getCrmData(ator),
    getChatPluginAtivo(),
    getNocodePluginAtivo(),
    listarFollowUpBots(),
  ])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="CRM"
        descricao="Organize o atendimento em departamentos e atendentes. Com o plugin Chat ativo, as conversas podem ser transferidas entre eles; cada departamento pode ter bots que respondem os leads enquanto nenhum humano assume e um bot de follow-up que retoma a conversa quando o lead fica sem responder."
      />
      <CrmManager
        dados={dados}
        followUpBots={followUpBots}
        chatAtivo={chatAtivo}
        usuarioAtualId={ator.id}
        ehRoot={ator.role === "root"}
        podeEditarNoCode={nocodeAtivo && podeAcessar(ator, "nocode")}
        podeAbrirAgentes={podeAcessar(ator, "agentes_ia")}
      />
    </div>
  )
}
