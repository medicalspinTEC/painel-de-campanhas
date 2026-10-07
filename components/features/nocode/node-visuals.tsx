import {
  Ban,
  Building2,
  GitBranch,
  ListOrdered,
  Megaphone,
  MessageCircle,
  MessageSquareReply,
  Phone,
  Puzzle,
  Send,
  Timer,
  UserCheck,
  UserSearch,
  Webhook,
  type LucideIcon,
} from "lucide-react"

import { PLUGIN_NOME, type PluginKey } from "@/lib/plugins"
import { NODE_CATALOG, opcoesDoMenu, OPERADORES, type FlowNode, type NodeDef } from "@/lib/nocode/catalog"

export const ICONES: Record<NodeDef["icone"], LucideIcon> = {
  Webhook,
  Phone,
  GitBranch,
  UserSearch,
  MessageSquareReply,
  Send,
  Timer,
  Ban,
  MessageCircle,
  ListOrdered,
  Building2,
  UserCheck,
  Megaphone,
  Puzzle,
}

/** Linha de resumo exibida no cartão do bloco, no canvas. */
export function resumoDoNo(no: FlowNode): string {
  const cfg = no.config
  switch (no.type) {
    case "webhook":
      return cfg.evento ? `Evento: ${String(cfg.evento)}` : "Qualquer evento"
    case "condicao": {
      const operador = OPERADORES.find((o) => o.value === cfg.operador)?.label ?? String(cfg.operador ?? "")
      const campo = String(cfg.campo ?? "").trim() || "(campo)"
      const valor = String(cfg.valor ?? "").trim()
      return `${campo} ${operador}${valor ? ` ${valor}` : ""}`
    }
    case "extrair_telefone":
      return String(cfg.campo ?? "") || NODE_CATALOG[no.type].label
    case "aguardar":
      return `${Number(cfg.segundos) || 0} s`
    case "enviar_mensagem":
      return String(cfg.texto ?? "").trim() || "(sem mensagem)"
    case "plugin_ativo":
      return `Plugin ${PLUGIN_NOME[cfg.plugin as PluginKey] ?? "(escolha)"} ativo?`
    case "mensagem_recebida":
      return "Lead enviou uma mensagem"
    case "menu": {
      const total = opcoesDoMenu(cfg).length
      return `${total} ${total === 1 ? "opção" : "opções"}`
    }
    case "transferir_atendente":
      return cfg.modo === "especifico" ? "Atendente específico" : "Distribuir entre atendentes"
    case "enviar_lead_campanha":
      return String(cfg.campanhaNome ?? "").trim() || (cfg.campanhaId ? "Campanha escolhida" : "(escolha a campanha)")
    case "transferir_departamento":
      return String(cfg.departamento ?? "").trim() || "(escolha o departamento)"
    default:
      return NODE_CATALOG[no.type].label
  }
}
