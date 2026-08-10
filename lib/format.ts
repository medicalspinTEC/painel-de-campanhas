import { format, formatDistanceToNow } from "date-fns"
import { ptBR } from "date-fns/locale"

export function formatDate(value: string | Date) {
  return format(new Date(value), "dd/MM/yyyy", { locale: ptBR })
}

export function formatDateTime(value: string | Date) {
  return format(new Date(value), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

export function formatTime(value: string | Date) {
  return format(new Date(value), "HH:mm", { locale: ptBR })
}

export function formatDayMonth(value: string | Date) {
  return format(new Date(value), "dd 'de' MMM", { locale: ptBR })
}

export function formatDayLabel(value: string | Date) {
  const data = new Date(value)
  const hoje = new Date()
  const ontem = new Date()
  ontem.setDate(hoje.getDate() - 1)
  if (data.toDateString() === hoje.toDateString()) return "Hoje"
  if (data.toDateString() === ontem.toDateString()) return "Ontem"
  return format(data, "EEEE, dd 'de' MMMM", { locale: ptBR })
}

export function formatRelative(value: string | Date) {
  return formatDistanceToNow(new Date(value), { locale: ptBR, addSuffix: true })
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value)
}

export function formatPercent(value: number, digits = 1) {
  return `${value.toFixed(digits).replace(".", ",")}%`
}

export function initials(nome: string) {
  return nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("")
}

export function firstName(nome: string) {
  return nome.split(" ")[0] ?? nome
}

/** Substitui as variáveis dinâmicas na pré-visualização das mensagens. */
export function renderTemplate(texto: string, nome = "Ana") {
  return texto
    .replace(/\{\{\s*primeiro_nome\s*\}\}/g, firstName(nome))
    .replace(/\{\{\s*nome\s*\}\}/g, nome)
}
