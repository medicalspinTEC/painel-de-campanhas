import { notFound } from "next/navigation"

import { KanbanBoard } from "@/components/features/kanban/kanban-board"
import { getKanbanBoard } from "@/services/kanban"
import { getKanbanPluginAtivo } from "@/services/settings"

export default async function KanbanPage() {
  if (!(await getKanbanPluginAtivo())) notFound()

  const board = await getKanbanBoard()

  return <KanbanBoard inicial={board} />
}
