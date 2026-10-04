"use server"

import { listEvents } from "@/services/events"
import { assertSecao } from "@/lib/session"

/** Notificações mais recentes (mesma consulta do cabeçalho), para o sino atualizar sem recarregar a página. */
export async function listNotificacoesAction() {
  await assertSecao("eventos")
  try {
    return await listEvents(30)
  } catch {
    return null
  }
}
