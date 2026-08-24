/*
 * Cálculo da próxima mensagem que um lead vai receber dentro de uma campanha.
 *
 * A engine de disparo (externa) usa `entradaCampanhaEm` como marco zero: cada
 * mensagem tem um `dia` de offset e um `horario` fixo. A projeção abaixo
 * espelha essa lógica reaproveitando o núcleo `campaign-engine-schedule`, para
 * que a UI mostre o mesmo instante que a engine vai usar.
 *
 * IMPORTANTE: a recorrência é contada DEPOIS da última mensagem da sequência,
 * não pela quantidade de mensagens. Se a recorrência for de 1 dia, o ciclo só
 * reinicia 24h após o horário da última mensagem — e assim por diante.
 */

import {
  horarioAgendado,
  normalizarCiclo,
  tempoReinicio,
  type AjusteHorario,
  type SlotAgendado,
} from "./campaign-engine-schedule"

export type MensagemAgendada = SlotAgendado

export function calcularProximaMensagem(
  entradaCampanhaEm: string | Date | null,
  campanha: { recorrenciaDias: number; mensagens: MensagemAgendada[] },
  agora: Date = new Date(),
  ajuste?: AjusteHorario,
): Date | null {
  if (!entradaCampanhaEm) return null
  if (!campanha.mensagens.length) return null

  const entrada = new Date(entradaCampanhaEm)
  if (Number.isNaN(entrada.getTime())) return null

  const recorrencia = campanha.recorrenciaDias > 0 ? campanha.recorrenciaDias : 1
  const mensagensOrdenadas = [...campanha.mensagens].sort((a, b) => a.dia - b.dia)
  // Nos ciclos de recorrência a sequência é normalizada para começar no dia 0:
  // a primeira mensagem dispara no instante em que a recorrência vence, sem
  // re-somar o offset inicial (ex.: dia 1) a cada reinício.
  const mensagensReinicio = normalizarCiclo(mensagensOrdenadas)

  // O 1º ciclo parte da entrada com os dias originais; os seguintes partem do
  // marco de recorrência com a sequência normalizada.
  let anchor = entrada
  let mensagensCiclo = mensagensOrdenadas
  for (let ciclo = 0; ciclo < 6; ciclo += 1) {
    for (const mensagem of mensagensCiclo) {
      const prevista = horarioAgendado(anchor, mensagem, ajuste)
      if (prevista.getTime() > agora.getTime()) {
        return prevista
      }
    }
    anchor = tempoReinicio(anchor, mensagensCiclo, recorrencia, ajuste)
    mensagensCiclo = mensagensReinicio
  }

  return null
}

export function formatarTempoAte(data: Date | null, agora: Date = new Date()): string {
  if (!data) return "—"

  const diffMs = data.getTime() - agora.getTime()
  if (diffMs <= 0) return "agora"

  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 60) return `em ${diffMin} min`

  const diffHoras = Math.floor(diffMin / 60)
  const minutosRestantes = diffMin % 60
  if (diffHoras < 24) {
    return minutosRestantes > 0 ? `em ${diffHoras}h ${minutosRestantes}min` : `em ${diffHoras}h`
  }

  const diffDias = Math.floor(diffHoras / 24)
  const horasRestantes = diffHoras % 24
  return horasRestantes > 0 ? `em ${diffDias}d ${horasRestantes}h` : `em ${diffDias}d`
}
