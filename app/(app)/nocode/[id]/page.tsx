import { notFound } from "next/navigation"

import { FlowEditor } from "@/components/features/nocode/flow-editor"
import { getFlow, listExecutions } from "@/services/nocode"
import { getNocodePluginAtivo } from "@/services/settings"

export const metadata = {
  title: "Editor No Code | Painel de Campanhas WhatsApp",
}

export default async function NoCodeEditorPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getNocodePluginAtivo())) notFound()

  const { id } = await params
  const fluxo = await getFlow(id).catch(() => null)
  if (!fluxo) notFound()

  const execucoes = await listExecutions(id).catch(() => [])

  return <FlowEditor fluxo={fluxo} execucoesIniciais={execucoes} />
}
