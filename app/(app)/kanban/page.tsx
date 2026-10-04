import { notFound } from "next/navigation"

import { KanbanBoard } from "@/components/features/kanban/kanban-board"
import { getKanbanBoard } from "@/services/kanban"
import { getKanbanPluginAtivo } from "@/services/settings"
import { requireSecao } from "@/lib/session"

export default async function KanbanPage() {
  await requireSecao("kanban")
  if (!(await getKanbanPluginAtivo())) notFound()

  const board = await getKanbanBoard()

  return <KanbanBoard inicial={board} />
}
