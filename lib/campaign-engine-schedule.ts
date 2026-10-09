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
  /**
   * `true` quando `cycleAnchor` já é o início de um ciclo REINICIADO pela
   * recorrência (e não a entrada original do lead). Nesse caso a sequência é
   * normalizada para começar no `dia 0`, de forma que a recorrência dispare a
   * primeira mensagem exatamente quando o contador vence — sem re-somar o offset
   * inicial (ex.: dia 1) a cada reinício.
   */
  cicloReiniciado?: boolean
  /**
   * Quando `true`, nenhum disparo cai em sábado ou domingo: o horário previsto é
   * empurrado para a próxima segunda-feira, preservando a hora do dia.
   */
  pausarNoFimDeSemana?: boolean
  /**
   * Janela de horário permitida para os disparos. Quando ativa, qualquer horário
   * fora do intervalo [inicio, fim] é empurrado para a próxima abertura da
   * janela (início do mesmo dia se ainda for cedo, ou início do dia seguinte se
   * já passou do fim).
   */
  janela?: JanelaHorario | null
}

/**
 * Janela de horário em que os disparos são permitidos. `inicio` e `fim` no
 * formato "HH:MM". Quando `ativa` é `false` a janela é ignorada.
 */
export interface JanelaHorario {
  ativa: boolean
  inicio: string
  fim: string
}

/** Opções de ajuste aplicadas a um horário previsto. */
export interface AjusteHorario {
  pausarNoFimDeSemana?: boolean
  janela?: JanelaHorario | null
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

/** Menor `dia` da sequência (nunca negativo). É o offset do primeiro disparo. */
export function diaMinimoCiclo<T extends SlotAgendado>(mensagens: T[]): number {
  if (!mensagens.length) return 0
  return Math.max(0, Math.min(...mensagens.map((m) => m.dia)))
}

/**
 * Normaliza a sequência para um ciclo de RECORRÊNCIA: subtrai o `dia` do
 * primeiro disparo de todos os `dia`, de modo que a primeira mensagem passe a
 * ser `dia 0` (dispara na própria âncora). Assim, ao reiniciar, o ciclo NÃO
 * volta a "contar" o offset inicial (ex.: dia 1) — ele apenas repete a sequência
 * a partir do instante em que a recorrência venceu, preservando o espaçamento
 * relativo entre as mensagens. Para sequências que já começam no dia 0, é um
 * no-op.
 */
export function normalizarCiclo<T extends SlotAgendado>(mensagens: T[]): T[] {
  const base = diaMinimoCiclo(mensagens)
  if (base === 0) return [...mensagens]
  return mensagens.map((m) => ({ ...m, dia: m.dia - base }))
}

/** Soma `dias` (mínimo 1) a uma data, preservando o horário. */
function somarDias(base: Date, dias: number): Date {
  const resultado = new Date(base)
  resultado.setDate(resultado.getDate() + Math.max(1, dias))
  return resultado
}

/**
 * Se `data` cair em um fim de semana, empurra para a próxima segunda-feira,
 * preservando o horário. Sábado (6) avança 2 dias; domingo (0) avança 1 dia.
 * Fora do fim de semana devolve a própria data.
 */
export function ajustarFimDeSemana(data: Date): Date {
  const diaDaSemana = data.getDay() // 0 = domingo, 6 = sábado
  if (diaDaSemana === 6) return somarDias(data, 2)
  if (diaDaSemana === 0) return somarDias(data, 1)
  return data
}

/** Converte "HH:MM" em minutos desde a meia-noite. Inválido devolve `null`. */
function minutosDoDia(horario: string): number | null {
  const [hora, minuto] = (horario ?? "").split(":").map(Number)
  if (Number.isNaN(hora) || Number.isNaN(minuto)) return null
  return hora * 60 + minuto
}

/**
 * Empurra `data` para dentro da janela de horário permitida. Se o horário for
 * anterior ao início da janela, avança para o início no MESMO dia; se for
 * posterior ao fim, avança para o início do dia SEGUINTE. Dentro da janela,
 * devolve a própria data.
 */
export function ajustarJanela(data: Date, janela: JanelaHorario): Date {
  const inicio = minutosDoDia(janela.inicio)
  const fim = minutosDoDia(janela.fim)
  if (inicio === null || fim === null || inicio >= fim) return data

  const minutosAtuais = data.getHours() * 60 + data.getMinutes()

  if (minutosAtuais < inicio) {
    const ajustada = new Date(data)
    ajustada.setHours(Math.floor(inicio / 60), inicio % 60, 0, 0)
    return ajustada
  }

  if (minutosAtuais > fim) {
    const ajustada = new Date(data)
    ajustada.setDate(ajustada.getDate() + 1)
    ajustada.setHours(Math.floor(inicio / 60), inicio % 60, 0, 0)
    return ajustada
  }

  return data
}

/**
 * Aplica os ajustes de disparo na ordem correta: primeiro a janela de horário
 * (que pode empurrar para o dia seguinte) e depois a pausa de fim de semana
 * (que empurra para segunda preservando a hora, já dentro da janela).
 */
function aplicarAjustes(data: Date, ajuste?: AjusteHorario): Date {
  let resultado = data
  if (ajuste?.janela?.ativa) {
    resultado = ajustarJanela(resultado, ajuste.janela)
  }
  if (ajuste?.pausarNoFimDeSemana) {
    resultado = ajustarFimDeSemana(resultado)
  }
  return resultado
}

/** Horário previsto de disparo de uma mensagem dentro do ciclo. */
export function horarioAgendado(
  cycleAnchor: Date,
  mensagem: SlotAgendado,
  ajuste?: AjusteHorario,
): Date {
  // Dia 0 dispara na própria âncora (entrada). Mesmo assim respeita a janela de
  // horário: se a entrada acontecer fora da janela, o disparo espera a abertura.
  if (mensagem.dia <= 0) return aplicarAjustes(new Date(cycleAnchor), ajuste)

  const previsto = new Date(cycleAnchor)
  previsto.setDate(previsto.getDate() + mensagem.dia)
  const [hora, minuto] = mensagem.horario.split(":").map(Number)
  previsto.setHours(hora || 0, minuto || 0, 0, 0)
  return aplicarAjustes(previsto, ajuste)
}

/** Momento em que o ciclo reinicia: recorrência após a última mensagem. */
export function tempoReinicio(
  cycleAnchor: Date,
  mensagens: SlotAgendado[],
  recorrenciaDias: number,
  ajuste?: AjusteHorario,
): Date {
  const ordenadas = ordenar(mensagens)
  const ultima = ordenadas[ordenadas.length - 1]
  const ultimaEm = horarioAgendado(cycleAnchor, ultima, ajuste)
  const reinicio = new Date(ultimaEm)
  reinicio.setDate(reinicio.getDate() + Math.max(1, recorrenciaDias))
  return aplicarAjustes(reinicio, ajuste)
}

export function decidirCiclo(input: LeadCycleInput, agora: Date = new Date()): LeadCycleDecision {
  const ajuste: AjusteHorario = {
    pausarNoFimDeSemana: input.pausarNoFimDeSemana,
    janela: input.janela,
  }
  // Em um ciclo reiniciado pela recorrência, a sequência é ancorada no dia 0
  // para que a primeira mensagem dispare no exato instante em que o contador
  // venceu — e não `recorrência + dia inicial` depois.
  const base = input.cicloReiniciado ? normalizarCiclo(input.mensagens) : input.mensagens
  const ordenadas = ordenar(base)
  const pendentes = ordenadas.filter((m) => !input.enviadosIds.has(m.id))

  if (pendentes.length > 0) {
    const alvo = pendentes[0]
    const alvoEm = horarioAgendado(input.cycleAnchor, alvo, ajuste)
    const seguinte = pendentes[1]
    const aguardandoRecorrencia = !seguinte

    if (alvoEm.getTime() <= agora.getTime()) {
      // Vai enviar agora. Se este é o último da sequência, a recorrência passa a
      // contar a partir DESTE envio (agora), não do slot teórico.
      const proximaEm = seguinte
        ? horarioAgendado(input.cycleAnchor, seguinte, ajuste)
        : aplicarAjustes(somarDias(agora, input.recorrenciaDias), ajuste)
      return { tipo: "enviar", mensagem: alvo, alvoEm, proximaEm, aguardandoRecorrencia }
    }
    // Ainda no futuro (ou fora da janela de horário): a contagem corre até este
    // alvo, que já reflete a próxima abertura da janela quando aplicável.
    return { tipo: "aguardar", proximaEm: alvoEm, aguardandoRecorrencia: false }
  }

  // Toda a sequência já foi enviada neste ciclo: aguarda a recorrência contada a
  // partir do ÚLTIMO ENVIO REAL. Sem esse dado, usa o slot teórico da última
  // mensagem como fallback.
  const reinicio = input.ultimoEnvioEm
    ? aplicarAjustes(somarDias(input.ultimoEnvioEm, input.recorrenciaDias), ajuste)
    : tempoReinicio(input.cycleAnchor, ordenadas, input.recorrenciaDias, ajuste)
  if (agora.getTime() >= reinicio.getTime()) {
    return { tipo: "reiniciar", novoAnchor: reinicio }
  }
  return { tipo: "aguardar", proximaEm: reinicio, aguardandoRecorrencia: true }
}
