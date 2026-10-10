import { notFound } from "next/navigation"

import { FlowEditor } from "@/components/features/nocode/flow-editor"
import { contarExecucoes, getFlow, listExecutions } from "@/services/nocode"
import { listCampanhasAbertas } from "@/services/campaigns"
import { listAtendentesAtivos } from "@/services/crm"
import { getCrmPluginAtivo, getNocodePluginAtivo } from "@/services/settings"
import { requireSecao } from "@/lib/session"

export const metadata = {
  title: "Editor No Code | Painel de Campanhas WhatsApp",
}

export default async function NoCodeEditorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSecao("nocode")
  if (!(await getNocodePluginAtivo())) notFound()

  const { id } = await params
  const fluxo = await getFlow(id).catch(() => null)
  if (!fluxo) notFound()

  const crmAtivo = await getCrmPluginAtivo().catch(() => false)
  const [execucoes, total, atendentes, campanhas] = await Promise.all([
    listExecutions(id).catch(() => []),
    contarExecucoes(id).catch(() => 0),
    // Atendentes só existem com o plugin CRM ativo; uma falha aqui nunca impede de abrir o editor.
    getCrmPluginAtivo()
      .then((ativo) => (ativo ? listAtendentesAtivos() : []))
      .catch(() => []),
    listCampanhasAbertas().catch(() => []),
  ])

  return <FlowEditor fluxo={fluxo} execucoesIniciais={execucoes} totalExecucoes={total} atendentes={atendentes} campanhas={campanhas} crmAtivo={crmAtivo} />
}
