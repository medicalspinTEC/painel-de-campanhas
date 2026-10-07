/**
 * Regras do bot de follow-up (funções puras: sem banco nem servidor, por isso rodam no cliente e
 * são fáceis de testar). O envio e a varredura ficam em `services/followup.ts`.
 */

export type BotRegra = {
  ativo: boolean
  ativadoEm: Date | null
  minutosSemResposta: number
  maxFollowUps: number
  janelaAtiva: boolean
  janelaInicio: number
  janelaFim: number
}

export type ConversaRegra = { desativado: boolean; enviados: number; ultimoEnvioEm: Date | null }

export type Avaliacao = {
  /** Pode enviar agora. */
  pode: boolean
  /** Quando o próximo follow-up sai, se houver um agendado. */
  proximoEm: Date | null
  /** Explica por que não há envio (ou por que está esperando). */
  motivo: string | null
  /** Follow-ups já enviados desde a última resposta do lead. */
  enviados: number
}

/** Follow-ups enviados desde a última resposta do lead (zera quando ele responde depois do último envio). */
export function sequenciaAtual(conv: ConversaRegra | null, ultimaResposta: Date | null): number {
  if (!conv || !conv.ultimoEnvioEm) return 0
  if (ultimaResposta && ultimaResposta.getTime() > conv.ultimoEnvioEm.getTime()) return 0
  return conv.enviados
}

function dentroDaJanela(bot: BotRegra, agora: Date): boolean {
  if (!bot.janelaAtiva) return true
  const hora = agora.getHours()
  return hora >= bot.janelaInicio && hora < bot.janelaFim
}

export function avaliarFollowUp(input: {
  bot: BotRegra
  conversa: ConversaRegra | null
  leadEmCampanha: boolean
  ultimaEnviada: Date | null
  ultimaResposta: Date | null
  agora: Date
}): Avaliacao {
  const { bot, conversa, leadEmCampanha, ultimaEnviada, ultimaResposta, agora } = input
  const enviados = sequenciaAtual(conversa, ultimaResposta)
  const parado = (motivo: string): Avaliacao => ({ pode: false, proximoEm: null, motivo, enviados })

  if (!bot.ativo) return parado("O bot de follow-up está desativado.")
  if (conversa?.desativado) return parado("O follow-up está desligado neste chat.")
  if (leadEmCampanha) return parado("O lead está em campanha: os bots só atendem conversas sem campanha.")
  if (!ultimaEnviada) return parado("Ainda não há mensagem da equipe nesta conversa.")
  if (ultimaResposta && ultimaResposta.getTime() >= ultimaEnviada.getTime()) {
    return parado("O lead foi o último a falar: o follow-up só sai quando ele fica sem responder à equipe.")
  }
  if (bot.ativadoEm && ultimaEnviada.getTime() < bot.ativadoEm.getTime()) {
    return parado("A última mensagem da equipe é anterior à ativação do bot; o follow-up vale a partir da próxima mensagem.")
  }
  if (enviados >= bot.maxFollowUps) {
    return parado("O limite de follow-ups foi atingido; recomeça quando o lead responder.")
  }

  const base = Math.max(ultimaEnviada.getTime(), conversa?.ultimoEnvioEm?.getTime() ?? 0)
  const proximoEm = new Date(base + bot.minutosSemResposta * 60_000)
  if (agora.getTime() < proximoEm.getTime()) {
    return { pode: false, proximoEm, motivo: null, enviados }
  }
  if (!dentroDaJanela(bot, agora)) {
    return {
      pode: false,
      proximoEm,
      motivo: `Fora da janela de envio (${bot.janelaInicio}h às ${bot.janelaFim}h); sai quando a janela abrir.`,
      enviados,
    }
  }
  return { pode: true, proximoEm, motivo: null, enviados }
}

export type TemplateBasico = { id: string; nome: string; texto: string }

/** Template do follow-up: o escolhido para o chat, o específico do bot ou um sorteado. */
export function escolherTemplate(
  bot: { modoTemplate: string; templateFixoId: string | null },
  ativos: TemplateBasico[],
  conversa: { templateId: string | null; ultimoTemplateId: string | null } | null,
  sorteio: () => number = Math.random,
): TemplateBasico | null {
  if (conversa?.templateId) {
    const manual = ativos.find((t) => t.id === conversa.templateId)
    if (manual) return manual
  }
  if (bot.modoTemplate === "especifico") {
    return ativos.find((t) => t.id === bot.templateFixoId) ?? null
  }
  if (ativos.length === 0) return null
  const candidatos = ativos.length > 1 ? ativos.filter((t) => t.id !== conversa?.ultimoTemplateId) : ativos
  return candidatos[Math.floor(sorteio() * candidatos.length)] ?? candidatos[0]
}

/** Quebra os minutos na maior unidade exata (90 min → 90 minutos; 120 → 2 horas; 1440 → 1 dia). */
export function separarTempo(minutos: number): { valor: number; unidade: "1" | "60" | "1440" } {
  if (minutos % 1440 === 0) return { valor: minutos / 1440, unidade: "1440" }
  if (minutos % 60 === 0) return { valor: minutos / 60, unidade: "60" }
  return { valor: minutos, unidade: "1" }
}

export function textoTempo(minutos: number): string {
  const { valor, unidade } = separarTempo(minutos)
  if (unidade === "1440") return `${valor} ${valor === 1 ? "dia" : "dias"}`
  if (unidade === "60") return `${valor} ${valor === 1 ? "hora" : "horas"}`
  return `${valor} ${valor === 1 ? "minuto" : "minutos"}`
}
