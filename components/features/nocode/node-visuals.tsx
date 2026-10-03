import { Ban, GitBranch, MessageSquareReply, Phone, Send, Timer, UserSearch, Webhook, type LucideIcon } from "lucide-react"

import { NODE_CATALOG, OPERADORES, type FlowNode, type NodeDef } from "@/lib/nocode/catalog"

export const ICONES: Record<NodeDef["icone"], LucideIcon> = {
  Webhook,
  Phone,
  GitBranch,
  UserSearch,
  MessageSquareReply,
  Send,
  Timer,
  Ban,
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
    default:
      return NODE_CATALOG[no.type].label
  }
}
