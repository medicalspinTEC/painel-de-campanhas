import { notFound } from "next/navigation"

import { FlowEditor } from "@/components/features/nocode/flow-editor"
import { contarExecucoes, getFlow, listExecutions } from "@/services/nocode"
import { getNocodePluginAtivo } from "@/services/settings"
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

  const [execucoes, total] = await Promise.all([
    listExecutions(id).catch(() => []),
    contarExecucoes(id).catch(() => 0),
  ])

  return <FlowEditor fluxo={fluxo} execucoesIniciais={execucoes} totalExecucoes={total} />
}
