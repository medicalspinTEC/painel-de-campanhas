"use server"

import { listEvents } from "@/services/events"

/** Notificações mais recentes (mesma consulta do cabeçalho), para o sino atualizar sem recarregar a página. */
export async function listNotificacoesAction() {
  try {
    return await listEvents(30)
  } catch {
    return null
  }
}
