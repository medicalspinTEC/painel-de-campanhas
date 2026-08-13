import { formatDistanceToNow } from "date-fns"
import { formatInTimeZone, toZonedTime } from "date-fns-tz"
import { ptBR } from "date-fns/locale"

/**
 * Fuso fixo da aplicação. Todas as datas são exibidas em horário do Brasil,
 * independentemente do fuso do servidor (que costuma ser UTC em produção).
 * As datas no banco são guardadas em UTC; aqui convertemos para São Paulo na
 * hora de exibir, então o resultado é sempre o mesmo em localhost e no servidor.
 */
const TZ = "America/Sao_Paulo"

export function formatDate(value: string | Date) {
  return formatInTimeZone(new Date(value), TZ, "dd/MM/yyyy", { locale: ptBR })
}

export function formatDateTime(value: string | Date) {
  return formatInTimeZone(new Date(value), TZ, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
}

export function formatTime(value: string | Date) {
  return formatInTimeZone(new Date(value), TZ, "HH:mm", { locale: ptBR })
}

export function formatDayMonth(value: string | Date) {
  return formatInTimeZone(new Date(value), TZ, "dd 'de' MMM", { locale: ptBR })
}

export function formatDayLabel(value: string | Date) {
  // Compara os dias já no fuso do Brasil para "Hoje"/"Ontem" ficarem corretos.
  const data = toZonedTime(new Date(value), TZ)
  const hoje = toZonedTime(new Date(), TZ)
  const ontem = new Date(hoje)
  ontem.setDate(hoje.getDate() - 1)
  if (data.toDateString() === hoje.toDateString()) return "Hoje"
  if (data.toDateString() === ontem.toDateString()) return "Ontem"
  return formatInTimeZone(new Date(value), TZ, "EEEE, dd 'de' MMMM", { locale: ptBR })
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
