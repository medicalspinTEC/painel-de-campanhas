import { notFound } from "next/navigation"

import { CrmManager } from "@/components/features/crm/crm-manager"
import { PageHeader } from "@/components/shared/page-header"
import { podeAcessar } from "@/lib/permissoes"
import { requirePoder } from "@/lib/session"
import { getCrmData } from "@/services/crm"
import { listarFollowUpBots } from "@/services/followup"
import { getFunilBoard, listarFunis } from "@/services/funis"
import { getChatPluginAtivo, getCrmPluginAtivo, getNocodePluginAtivo } from "@/services/settings"

export const metadata = {
  title: "CRM | Painel de Campanhas WhatsApp",
}

export default async function CrmPage() {
  const ator = await requirePoder("crm_gerenciar")
  if (!(await getCrmPluginAtivo())) notFound()

  const [dados, chatAtivo, nocodeAtivo, followUpBots, funis] = await Promise.all([
    getCrmData(ator),
    getChatPluginAtivo(),
    getNocodePluginAtivo(),
    listarFollowUpBots(),
    listarFunis(),
  ])
  // Só o quadro do primeiro funil vem pronto; os outros são carregados ao selecioná-los.
  const funilBoardInicial = funis[0] ? await getFunilBoard(funis[0].id) : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="CRM"
        descricao="Organize o atendimento em departamentos e atendentes e acompanhe os leads em funis de vendas. Com o plugin Chat ativo, as conversas podem ser transferidas entre eles; cada departamento pode ter bots que respondem os leads enquanto nenhum humano assume e um bot de follow-up que retoma a conversa quando o lead fica sem responder."
      />
      <CrmManager
        dados={dados}
        followUpBots={followUpBots}
        funis={funis}
        funilBoardInicial={funilBoardInicial}
        chatAtivo={chatAtivo}
        usuarioAtualId={ator.id}
        ehRoot={ator.role === "root"}
        podeEditarNoCode={nocodeAtivo && podeAcessar(ator, "nocode")}
        podeAbrirAgentes={podeAcessar(ator, "agentes_ia")}
      />
    </div>
  )
}
