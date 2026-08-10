/*
 * Cálculo da próxima mensagem que um lead vai receber dentro de uma campanha.
 *
 * A engine de disparo (externa) usa `entradaCampanhaEm` como marco zero: cada
 * mensagem tem um `dia` de offset e um `horario` fixo. A projeção abaixo
 * espelha essa lógica para que a UI mostre o mesmo instante que a engine vai
 * usar. Por isso ajustar `entradaCampanhaEm` adianta ou atrasa o próximo envio.
 */

export interface MensagemAgendada {
  dia: number
  horario: string
}

export function calcularProximaMensagem(
  entradaCampanhaEm: string | Date | null,
  campanha: { recorrenciaDias: number; mensagens: MensagemAgendada[] },
  agora: Date = new Date(),
): Date | null {
  if (!entradaCampanhaEm) return null

  const entrada = new Date(entradaCampanhaEm)
  const mensagensOrdenadas = [...campanha.mensagens].sort((a, b) => a.dia - b.dia)

  for (let ciclo = 0; ciclo < 6; ciclo += 1) {
    const baseDoCiclo = new Date(entrada)
    baseDoCiclo.setDate(baseDoCiclo.getDate() + ciclo * campanha.recorrenciaDias)

    for (const mensagem of mensagensOrdenadas) {
      const prevista = new Date(baseDoCiclo)
      prevista.setDate(prevista.getDate() + mensagem.dia)

      const [hora, minuto] = mensagem.horario.split(":").map(Number)
      prevista.setHours(hora || 0, minuto || 0, 0, 0)

      if (prevista.getTime() > agora.getTime()) {
        return prevista
      }
    }
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
