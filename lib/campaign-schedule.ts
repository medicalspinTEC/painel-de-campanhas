/*
 * Lógica compartilhada entre Server e Client Components para calcular quando a
 * próxima mensagem de uma campanha deve ser enviada a um lead.
 *
 * A "próxima mensagem" é derivada de dois valores persistidos no lead:
 *   - `entradaCampanhaEm`: âncora a partir da qual o cronograma (dia/horário) é
 *     projetado, reiniciando a cada `recorrenciaDias`;
 *   - `ultimoContato`: data da última mensagem já enviada, usada para saber
 *     quais ocorrências ainda estão pendentes.
 *
 * Uma ocorrência no passado que ainda não foi enviada (posterior ao último
 * contato) é considerada VENCIDA e reportada como "agora", em vez de ser
 * ignorada — assim o operador enxerga mensagens prontas para disparar.
 *
 * A recorrência é contada DEPOIS da última mensagem da sequência (reaproveitando
 * o núcleo `campaign-engine-schedule`), e não pela quantidade de mensagens. Com
 * recorrência de 1 dia, o ciclo só reinicia 24h após a última mensagem.
 */

import {
  horarioAgendado,
  tempoReinicio,
  type AjusteHorario,
  type SlotAgendado,
} from "./campaign-engine-schedule"

export interface ScheduleCampaign {
  recorrenciaDias: number
  mensagens: Array<SlotAgendado>
}

export interface ProximaMensagem {
  data: Date
  /** true quando a ocorrência já passou e continua pendente de envio. */
  vencida: boolean
}

export function calcularProximaMensagem(
  entradaCampanhaEm: string | Date | null,
  ultimoContato: string | Date | null,
  campanha: ScheduleCampaign,
  ajuste?: AjusteHorario,
): ProximaMensagem | null {
  if (!entradaCampanhaEm) return null
  if (!campanha.mensagens.length) return null

  const entrada = new Date(entradaCampanhaEm)
  if (Number.isNaN(entrada.getTime())) return null

  const ultimo = ultimoContato ? new Date(ultimoContato) : null
  const agora = Date.now()
  const recorrencia = campanha.recorrenciaDias > 0 ? campanha.recorrenciaDias : 1
  const mensagensOrdenadas = [...campanha.mensagens].sort((a, b) => a.dia - b.dia)

  // Cada ciclo começa na âncora; o próximo ciclo só inicia `recorrencia` dias
  // após o horário da última mensagem (via `tempoReinicio`).
  let anchor = entrada
  for (let ciclo = 0; ciclo < 8; ciclo += 1) {
    for (const mensagem of mensagensOrdenadas) {
      const prevista = horarioAgendado(anchor, mensagem, ajuste)
      const tempo = prevista.getTime()

      if (tempo > agora) {
        // Primeira ocorrência ainda no futuro: essa é a próxima.
        return { data: prevista, vencida: false }
      }

      // Ocorrência no passado: pendente somente se ainda não foi enviada.
      if (!ultimo || tempo > ultimo.getTime()) {
        return { data: prevista, vencida: true }
      }
      // Caso contrário já foi enviada; segue procurando a próxima.
    }

    anchor = tempoReinicio(anchor, mensagensOrdenadas, recorrencia, ajuste)
  }

  return null
}

export function formatarTempoAte(proxima: ProximaMensagem | null): string {
  if (!proxima) return "—"
  if (proxima.vencida) return "agora"

  const diffMs = proxima.data.getTime() - Date.now()
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
