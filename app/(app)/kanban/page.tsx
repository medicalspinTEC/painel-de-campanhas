import { notFound } from "next/navigation"

import { KanbanBoard } from "@/components/features/kanban/kanban-board"
import { KanbanCampanhaBoard } from "@/components/features/kanban/kanban-campanha-board"
import { getKanbanBoard, getKanbanCampanhaBoard } from "@/services/kanban"
import { getKanbanPluginAtivo } from "@/services/settings"
import { requireSecao } from "@/lib/session"

export default async function KanbanPage({ searchParams }: { searchParams: Promise<{ campanha?: string | string[] }> }) {
  await requireSecao("kanban")
  if (!(await getKanbanPluginAtivo())) notFound()

  const { campanha } = await searchParams
  const campanhaId = (Array.isArray(campanha) ? campanha[0] : campanha)?.trim() || null

  const board = await getKanbanBoard()

  // Modo "gerir campanha": as colunas deixam de ser o status do lead e passam a ser as etapas da campanha.
  if (campanhaId) {
    const quadroCampanha = await getKanbanCampanhaBoard(campanhaId)
    if (quadroCampanha) {
      const { campanha: aberta } = quadroCampanha
      // Campanhas encerradas não vêm na lista do quadro de leads, mas podem ser consultadas aqui.
      const campanhas = board.campanhas.some((item) => item.id === aberta.id)
        ? board.campanhas
        : [{ id: aberta.id, nome: aberta.nome, tipo: aberta.tipo, status: aberta.status }, ...board.campanhas]
      return <KanbanCampanhaBoard key={aberta.id} inicial={quadroCampanha} campanhas={campanhas} />
    }
  }

  return <KanbanBoard inicial={board} />
}
