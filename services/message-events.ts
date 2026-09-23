import { renderTemplate } from "@/lib/format"
import { prisma } from "@/lib/prisma"
import { emitDisparoWebhook, emitWebhookEvent } from "@/services/webhooks"

/**
 * Eventos de mensagem reportados pela engine de disparo.
 *
 * O painel não envia mensagens por conta própria: quem envia é a engine externa,
 * que reporta cada acontecimento aqui. Este módulo é o único ponto que grava o
 * evento na timeline e notifica os webhooks assinados, para que as duas coisas
 * nunca saiam de sincronia.
 */
export type MessageEventKind = "enviada" | "falha" | "resposta" | "agendada"

export interface MessageEventInput {
  kind: MessageEventKind
  leadId: string
  campanhaId?: string | null
  mensagemId?: string | null
  descricao?: string
  detalhes?: string | null
  /**
   * Conteúdo real da mensagem (já personalizado para o lead). Quem envia sabe o
   * texto exato — inclusive em campanhas `individual` e envios avulsos, que não
   * têm `mensagemId`. Quando ausente, cai no texto da mensagem vinculada.
   * Em `resposta`, é o texto que o lead escreveu.
   */
  texto?: string | null
  /** Só usado por `agendada`: quando o disparo deve acontecer. */
  agendadoPara?: string | null
}

/** Evento de webhook correspondente a cada tipo reportado. */
const EVENTO_WEBHOOK: Record<MessageEventKind, string> = {
  enviada: "mensagem.enviada",
  falha: "mensagem.falha",
  resposta: "mensagem.resposta",
  agendada: "mensagem.agendada",
}

/*
 * `agendada` fica fora do enum EventType do banco: um agendamento é uma intenção
 * futura, não um acontecimento da timeline. Por isso ele só notifica webhooks.
 */
const TIPO_TIMELINE = {
  enviada: "mensagem_enviada",
  falha: "falha",
  resposta: "resposta",
} as const

const DESCRICAO_PADRAO: Record<MessageEventKind, string> = {
  enviada: "Mensagem enviada pela engine.",
  falha: "Falha no envio da mensagem.",
  resposta: "Lead respondeu à mensagem.",
  agendada: "Mensagem agendada para a próxima janela de envio.",
}

export async function recordMessageEvent(input: MessageEventInput): Promise<{ ok: boolean; erro?: string }> {
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { id: true, nome: true, telefone: true, status: true, campanhaId: true },
  })
  if (!lead) return { ok: false, erro: "Lead não encontrado." }

  const campanhaId = input.campanhaId ?? lead.campanhaId
  const descricao = input.descricao?.trim() || DESCRICAO_PADRAO[input.kind]
  const tipo = input.kind === "agendada" ? null : TIPO_TIMELINE[input.kind]

  const [campanha, mensagem] = await Promise.all([
    campanhaId
      ? prisma.campaign.findUnique({ where: { id: campanhaId }, select: { nome: true } })
      : Promise.resolve(null),
    input.mensagemId
      ? prisma.campaignMessage.findUnique({ where: { id: input.mensagemId }, select: { texto: true } })
      : Promise.resolve(null),
  ])

  /*
   * Registra o conteúdo real da mensagem no histórico do lead e no feed de
   * eventos — não apenas metadados como o telefone de destino. O texto informado
   * por quem enviou tem prioridade (é exatamente o que saiu, já personalizado);
   * sem ele, usa o modelo da mensagem vinculada renderizado para este lead. O
   * texto fica gravado em `detalhes`, seguido das informações complementares
   * (ex.: "Enviada para 55...") do chamador.
   */
  const textoInformado = input.texto?.trim() || null
  const textoVinculado = mensagem?.texto?.trim() ? renderTemplate(mensagem.texto.trim(), lead.nome.trim()) : null
  const textoMensagem = textoInformado ?? textoVinculado
  const detalhesTimeline =
    [textoMensagem ? `Mensagem: "${textoMensagem}"` : null, input.detalhes?.trim() || null]
      .filter(Boolean)
      .join("\n") || null

  /*
   * Conteúdo enviado aos webhooks no campo `mensagem`. Em `resposta` só vale o
   * que o lead escreveu: o texto vinculado seria a mensagem que *nós* enviamos,
   * o que induziria o destinatário a erro.
   */
  const textoWebhook = input.kind === "resposta" ? textoInformado : textoMensagem

  let eventoId: string | null = null
  if (tipo) {
    const evento = await prisma.timelineEvent.create({
      data: {
        leadId: lead.id,
        campanhaId,
        mensagemId: input.mensagemId ?? null,
        tipo,
        descricao,
        detalhes: detalhesTimeline,
        sucesso: input.kind !== "falha",
      },
      select: { id: true },
    })
    eventoId = evento.id
  }

  /*
   * Uma resposta do lead avança o funil quando ele ainda não engajou — a mesma
   * regra que o painel aplica na tela de leads.
   */
  if (input.kind === "resposta" && (lead.status === "novo" || lead.status === "em_campanha")) {
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "respondeu" } })
  }

  await emitWebhookEvent(EVENTO_WEBHOOK[input.kind], {
    eventoId,
    lead: { id: lead.id, nome: lead.nome, telefone: lead.telefone },
    campanhaId,
    mensagemId: input.mensagemId ?? null,
    descricao,
    mensagem: textoWebhook,
    detalhes: input.detalhes ?? null,
    ...(input.kind === "agendada" ? { agendadoPara: input.agendadoPara ?? null } : {}),
  })

  await emitDisparoWebhook({
    campanha: campanha?.nome ?? null,
    nome: lead.nome,
    telefone: lead.telefone,
    mensagem: textoWebhook ?? input.detalhes ?? descricao,
    leadId: lead.id,
    campanhaId,
    mensagemId: input.mensagemId ?? null,
    tipo: input.kind,
  })

  return { ok: true }
}
