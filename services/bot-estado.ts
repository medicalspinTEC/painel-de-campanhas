import { prisma } from "@/lib/prisma"

/**
 * Estado do bot numa conversa (tabela `BotConversa`, no máximo uma linha por lead).
 *
 * Só leitura/escrita do estado: quem decide o que o bot responde é `services/bots.ts`.
 * Este módulo não importa nenhum outro serviço de propósito, para o CRM e o motor do
 * No Code poderem usá-lo sem criar import circular.
 *
 * Regra de negócio: quando um humano assume a conversa o bot é PAUSADO e só volta
 * quando alguém o reativa para ESSA conversa (`reativarBot`).
 */

export type BotConversaInfo = {
  ativo: boolean
  motivo: string | null
  /** O bot está esperando o lead escolher uma opção de menu. */
  aguardando: boolean
}

/**
 * Pausa o bot na conversa. Cria a linha se ela não existir (assim o bot não responde
 * numa conversa que um humano já está conduzindo, mesmo que o bot nunca tenha falado).
 * Devolve `true` quando o estado mudou de "ligado" para "pausado".
 */
export async function pausarBot(leadId: string, motivo: string): Promise<boolean> {
  const atual = await prisma.botConversa.findUnique({ where: { leadId }, select: { botAtivo: true } })
  if (atual && !atual.botAtivo) return false

  const agora = new Date()
  await prisma.botConversa.upsert({
    where: { leadId },
    create: { leadId, botAtivo: false, pausadoMotivo: motivo, pausadoEm: agora },
    // Pausar também encerra qualquer menu que estivesse esperando resposta.
    update: { botAtivo: false, pausadoMotivo: motivo, pausadoEm: agora, aguardandoNoId: null, tentativas: 0 },
  })
  return true
}

/**
 * Liga o bot de novo nesta conversa. Zera a sessão: na próxima mensagem do lead o bot
 * recomeça do início, em vez de retomar um menu antigo.
 */
export async function reativarBot(leadId: string): Promise<void> {
  await prisma.botConversa.upsert({
    where: { leadId },
    create: { leadId, botAtivo: true },
    update: {
      botAtivo: true,
      pausadoMotivo: null,
      pausadoEm: null,
      flowId: null,
      aguardandoNoId: null,
      tentativas: 0,
    },
  })
}

export async function getBotConversa(leadId: string) {
  return prisma.botConversa.findUnique({ where: { leadId } })
}

/** Estado do bot de cada conversa que já teve interação com bot (leads sem linha ficam de fora). */
export async function listBotsPorLead(): Promise<Map<string, BotConversaInfo>> {
  const linhas = await prisma.botConversa.findMany({
    select: { leadId: true, botAtivo: true, pausadoMotivo: true, aguardandoNoId: true },
  })
  return new Map(
    linhas.map((linha) => [
      linha.leadId,
      { ativo: linha.botAtivo, motivo: linha.pausadoMotivo, aguardando: Boolean(linha.aguardandoNoId) },
    ]),
  )
}
