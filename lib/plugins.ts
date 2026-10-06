/**
 * Registro dos plugins do painel.
 *
 * Arquivo puro (sem servidor/cliente). Regra de ouro: plugin desativado NÃO é só menu escondido —
 * tudo o que deriva dele (páginas, ações, rotas de API, blocos do No Code, bots, eventos de
 * webhook, rotinas em segundo plano) deixa de funcionar. As checagens ficam em:
 *
 *  - `lib/session.ts`: seções ligadas a um plugin (`SECAO_PLUGIN`) — páginas, server actions e APIs;
 *  - `services/settings.ts`: `exigirPlugin` / `isPluginAtivo`, para serviços e rotas sem sessão;
 *  - `lib/webhook-events.ts`: eventos de webhook que só existem com um plugin (`plugin`).
 */
import type { SecaoKey } from "@/lib/permissoes"

export type PluginKey = "chat" | "kanban" | "assistente" | "nocode" | "crm"

export type PluginsAtivos = Record<PluginKey, boolean>

export const PLUGIN_NOME: Record<PluginKey, string> = {
  chat: "Chat",
  kanban: "Kanban",
  assistente: "Assistente",
  nocode: "No Code",
  crm: "CRM",
}

/** Seções do painel que só existem com o plugin ativo. */
export const SECAO_PLUGIN: Partial<Record<SecaoKey, PluginKey>> = {
  chat: "chat",
  kanban: "kanban",
  assistente: "assistente",
  nocode: "nocode",
}

export const PLUGINS_TODOS_DESATIVADOS: PluginsAtivos = {
  chat: false,
  kanban: false,
  assistente: false,
  nocode: false,
  crm: false,
}

export function mensagemPluginDesativado(plugin: PluginKey): string {
  return `O plugin ${PLUGIN_NOME[plugin]} está desativado.`
}

/** Lançado quando algo do plugin é chamado com ele desativado. */
export class PluginDesativadoError extends Error {
  readonly plugin: PluginKey

  constructor(plugin: PluginKey) {
    super(mensagemPluginDesativado(plugin))
    this.name = "PluginDesativadoError"
    this.plugin = plugin
  }
}
