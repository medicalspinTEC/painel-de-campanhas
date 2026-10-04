/**
 * Agenda do backup automático. Funções puras (sem banco), usadas pelo serviço e pela tela.
 * Os horários seguem o fuso do processo (o app fixa America/Sao_Paulo em `instrumentation.ts`).
 */

export type ModoAgenda = "intervalo" | "diario" | "semanal"

export interface AgendaBackup {
  modo: ModoAgenda
  /** Só no modo "intervalo". */
  intervaloHoras: number
  /** "HH:mm" (modos diário e semanal). */
  horario: string
  /** 0 = domingo … 6 = sábado (modo semanal). */
  diaSemana: number
}

export const MODOS_AGENDA: ModoAgenda[] = ["intervalo", "diario", "semanal"]
export const DIAS_SEMANA = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"]
export const INTERVALO_MIN_HORAS = 1
export const INTERVALO_MAX_HORAS = 168

const HORARIO = /^([01]\d|2[0-3]):([0-5]\d)$/

export function horarioValido(valor: unknown): valor is string {
  return typeof valor === "string" && HORARIO.test(valor)
}

/** Devolve a agenda normalizada ou o motivo de ela ser inválida. */
export function validarAgenda(entrada: Partial<Record<keyof AgendaBackup, unknown>>): { ok: true; agenda: AgendaBackup } | { ok: false; erro: string } {
  const modo = entrada.modo
  if (!MODOS_AGENDA.includes(modo as ModoAgenda)) return { ok: false, erro: "Escolha a frequência do backup automático." }

  const intervaloHoras = Number(entrada.intervaloHoras)
  if (modo === "intervalo" && (!Number.isInteger(intervaloHoras) || intervaloHoras < INTERVALO_MIN_HORAS || intervaloHoras > INTERVALO_MAX_HORAS)) {
    return { ok: false, erro: `O intervalo deve ser de ${INTERVALO_MIN_HORAS} a ${INTERVALO_MAX_HORAS} horas.` }
  }

  if (modo !== "intervalo" && !horarioValido(entrada.horario)) return { ok: false, erro: "Informe o horário no formato HH:mm." }

  const diaSemana = Number(entrada.diaSemana)
  if (modo === "semanal" && (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6)) {
    return { ok: false, erro: "Escolha o dia da semana." }
  }

  return {
    ok: true,
    agenda: {
      modo: modo as ModoAgenda,
      intervaloHoras: Number.isInteger(intervaloHoras) && intervaloHoras >= 1 ? Math.min(intervaloHoras, INTERVALO_MAX_HORAS) : 24,
      horario: horarioValido(entrada.horario) ? entrada.horario : "03:00",
      diaSemana: Number.isInteger(diaSemana) && diaSemana >= 0 && diaSemana <= 6 ? diaSemana : 0,
    },
  }
}

/** Próxima execução estritamente depois de `de`. Atrasos não geram execuções repetidas: conta a partir de `de`. */
export function proximaExecucao(agenda: AgendaBackup, de: Date = new Date()): Date {
  if (agenda.modo === "intervalo") {
    return new Date(de.getTime() + Math.max(agenda.intervaloHoras, 1) * 60 * 60 * 1000)
  }

  const [hora, minuto] = agenda.horario.split(":").map(Number)
  const alvo = new Date(de)
  alvo.setHours(hora, minuto, 0, 0)

  if (agenda.modo === "diario") {
    if (alvo.getTime() <= de.getTime()) alvo.setDate(alvo.getDate() + 1)
    return alvo
  }

  alvo.setDate(alvo.getDate() + ((agenda.diaSemana - alvo.getDay() + 7) % 7))
  if (alvo.getTime() <= de.getTime()) alvo.setDate(alvo.getDate() + 7)
  return alvo
}

/** Texto curto para a tela: "Todo dia às 03:00", "A cada 6 horas"… */
export function descreverAgenda(agenda: AgendaBackup): string {
  if (agenda.modo === "intervalo") return agenda.intervaloHoras === 1 ? "A cada hora" : `A cada ${agenda.intervaloHoras} horas`
  if (agenda.modo === "diario") return `Todo dia às ${agenda.horario}`
  return `Toda ${DIAS_SEMANA[agenda.diaSemana].toLowerCase()} às ${agenda.horario}`
}
