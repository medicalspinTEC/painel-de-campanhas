/*
 * Núcleo puro (sem banco) do agendamento de campanhas. Decide, para um lead
 * dentro de um ciclo da campanha, qual é a próxima ação: enviar a mensagem
 * pendente, aguardar até o horário previsto, ou reiniciar o ciclo depois da
 * recorrência.
 *
 * Modelo de tempo:
 *   - `cycleAnchor` é o início do ciclo atual do lead (entrada na campanha ou o
 *     último reinício). Todas as mensagens são projetadas a partir dele.
 *   - Cada mensagem tem um `dia` (offset em dias a partir da âncora) e um
 *     `horario` fixo ("HH:MM"). O horário previsto de disparo é
 *     `âncora + dia (dias)` no `horario`.
 *   - A mensagem de `dia 0` dispara imediatamente na entrada do ciclo (a âncora),
 *     sem esperar o `horario`.
 *   - A recorrência é o tempo de espera DEPOIS da última mensagem: o ciclo
 *     reinicia `recorrenciaDias` após o horário previsto da última mensagem.
 *
 * Tanto a engine de disparo quanto a projeção exibida na UI usam este módulo,
 * para que o que o operador vê seja exatamente o que a engine executa.
 */

export interface EngineMessage {
  id: string
  dia: number
  horario: string
  texto: string
}

/**
 * Forma mínima necessária para projetar o horário de uma mensagem no ciclo.
 * Tanto a engine (`EngineMessage`) quanto as projeções da UI usam este núcleo.
 */
export interface SlotAgendado {
  dia: number
  horario: string
}

export interface LeadCycleInput {
  /** Início do ciclo atual do lead nesta campanha. */
  cycleAnchor: Date
  /** Mensagens da campanha (serão reordenadas por `dia`). */
  mensagens: EngineMessage[]
  /** Ids de mensagens já enviadas neste ciclo (após a âncora). */
  enviadosIds: Set<string>
  /** Dias de espera após a última mensagem até reiniciar o ciclo. */
  recorrenciaDias: number
  /**
   * Momento REAL em que a última mensagem deste ciclo foi enviada. A recorrência
   * é contada a partir daqui — se for 1 dia, o ciclo reinicia 24h após este
   * instante, independentemente do `dia` teórico da última mensagem. Quando
   * ausente, cai no slot teórico (`tempoReinicio`).
   */
  ultimoEnvioEm?: Date | null
}

export type LeadCycleDecision =
  | {
      tipo: "enviar"
      mensagem: EngineMessage
      /** Horário previsto (no passado) do alvo — usado para exibir "agora". */
      alvoEm: Date
      /** Próximo marco após este envio (mensagem seguinte ou reinício). */
      proximaEm: Date
      aguardandoRecorrencia: boolean
    }
  | { tipo: "aguardar"; proximaEm: Date; aguardandoRecorrencia: boolean }
  | { tipo: "reiniciar"; novoAnchor: Date }

function ordenar<T extends SlotAgendado>(mensagens: T[]): T[] {
  return [...mensagens].sort((a, b) => a.dia - b.dia)
}

/** Soma `dias` (mínimo 1) a uma data, preservando o horário. */
function somarDias(base: Date, dias: number): Date {
  const resultado = new Date(base)
  resultado.setDate(resultado.getDate() + Math.max(1, dias))
  return resultado
}

/** Horário previsto de disparo de uma mensagem dentro do ciclo. */
export function horarioAgendado(cycleAnchor: Date, mensagem: SlotAgendado): Date {
  // Dia 0 dispara na própria âncora (entrada), sem esperar o horário do dia.
  if (mensagem.dia <= 0) return new Date(cycleAnchor)

  const previsto = new Date(cycleAnchor)
  previsto.setDate(previsto.getDate() + mensagem.dia)
  const [hora, minuto] = mensagem.horario.split(":").map(Number)
  previsto.setHours(hora || 0, minuto || 0, 0, 0)
  return previsto
}

/** Momento em que o ciclo reinicia: recorrência após a última mensagem. */
export function tempoReinicio(cycleAnchor: Date, mensagens: SlotAgendado[], recorrenciaDias: number): Date {
  const ordenadas = ordenar(mensagens)
  const ultima = ordenadas[ordenadas.length - 1]
  const ultimaEm = horarioAgendado(cycleAnchor, ultima)
  const reinicio = new Date(ultimaEm)
  reinicio.setDate(reinicio.getDate() + Math.max(1, recorrenciaDias))
  return reinicio
}

export function decidirCiclo(input: LeadCycleInput, agora: Date = new Date()): LeadCycleDecision {
  const ordenadas = ordenar(input.mensagens)
  const pendentes = ordenadas.filter((m) => !input.enviadosIds.has(m.id))

  if (pendentes.length > 0) {
    const alvo = pendentes[0]
    const alvoEm = horarioAgendado(input.cycleAnchor, alvo)
    const seguinte = pendentes[1]
    const aguardandoRecorrencia = !seguinte

    if (alvoEm.getTime() <= agora.getTime()) {
      // Vai enviar agora. Se este é o último da sequência, a recorrência passa a
      // contar a partir DESTE envio (agora), não do slot teórico.
      const proximaEm = seguinte
        ? horarioAgendado(input.cycleAnchor, seguinte)
        : somarDias(agora, input.recorrenciaDias)
      return { tipo: "enviar", mensagem: alvo, alvoEm, proximaEm, aguardandoRecorrencia }
    }
    // Ainda no futuro: a contagem corre até este alvo (envio pendente).
    return { tipo: "aguardar", proximaEm: alvoEm, aguardandoRecorrencia: false }
  }

  // Toda a sequência já foi enviada neste ciclo: aguarda a recorrência contada a
  // partir do ÚLTIMO ENVIO REAL. Sem esse dado, usa o slot teórico da última
  // mensagem como fallback.
  const reinicio = input.ultimoEnvioEm
    ? somarDias(input.ultimoEnvioEm, input.recorrenciaDias)
    : tempoReinicio(input.cycleAnchor, ordenadas, input.recorrenciaDias)
  if (agora.getTime() >= reinicio.getTime()) {
    return { tipo: "reiniciar", novoAnchor: reinicio }
  }
  return { tipo: "aguardar", proximaEm: reinicio, aguardandoRecorrencia: true }
}
