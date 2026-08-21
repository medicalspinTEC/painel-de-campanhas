import { prisma } from "@/lib/prisma"
import { recordAppLog } from "@/services/app-logs"
import { emitWebhookEvent } from "@/services/webhooks"

/**
 * Processamento do evento externo "RespostaLead".
 *
 * O webhook de entrada recebe o payload da Evolution API quando um contato
 * interage no WhatsApp. Este módulo:
 *   1. valida que a mensagem partiu do lead, e não do número monitorado
 *      (`fromMe === false`);
 *   2. extrai o telefone do `remoteJid` (formato "55DDNUMERO@s.whatsapp.net");
 *   3. localiza o lead correspondente;
 *   4. se o lead estiver em mais de uma campanha, escolhe aquela que enviou a
 *      última mensagem (é ela quem "qualifica" o lead);
 *   5. registra a resposta na timeline (visível no feed de eventos);
 *   6. marca o lead como qualificado, atribuindo a qualificação à campanha da
 *      última mensagem, e o remove de TODAS as campanhas em que estava.
 */

export interface RespostaLeadResultado {
  ok: boolean
  motivo?: string
  leadId?: string
  campanhaId?: string | null
}

/** Extrai apenas os dígitos de um valor. */
function digitos(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "")
}

/**
 * Extrai o número de telefone do `remoteJid` do WhatsApp.
 * Ex.: "557991200617@s.whatsapp.net" -> "557991200617".
 */
function telefoneDoRemoteJid(remoteJid: string): string {
  const base = remoteJid.split("@")[0]?.split(":")[0] ?? ""
  return digitos(base)
}

/**
 * Reduz um número brasileiro a um "núcleo" comparável — DDD + 8 dígitos finais —
 * ignorando o código do país (55) e o nono dígito, que variam conforme a origem.
 * Assim "557991200617" e "+55 (79) 9 9120-0617" batem no mesmo núcleo.
 */
function nucleoTelefone(raw: string): string {
  let d = digitos(raw)
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2)
  if (d.length >= 10) {
    const ddd = d.slice(0, 2)
    const ultimos8 = d.slice(2).slice(-8)
    return ddd + ultimos8
  }
  return d
}

/** Dois telefones são o mesmo se forem iguais ou compartilharem o núcleo BR. */
function telefonesBatem(a: string, b: string): boolean {
  const da = digitos(a)
  const db = digitos(b)
  if (!da || !db) return false
  if (da === db) return true
  if (da.endsWith(db) || db.endsWith(da)) return true
  return nucleoTelefone(da) === nucleoTelefone(db)
}

interface MensagemRecebida {
  fromMe: boolean
  remoteJid: string
  texto: string
  pushName: string | null
}

/**
 * Navega o payload de forma tolerante: o evento pode chegar como o corpo
 * completo do webhook (`{ body: { data: { ... } } }`), como `{ data: { ... } }`
 * ou já como o próprio objeto `data`.
 */
function extrairMensagem(payload: unknown): MensagemRecebida {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = payload as any
  const data = p?.body?.data ?? p?.data ?? p ?? {}
  const key = data?.key ?? {}
  const message = data?.message ?? {}

  const texto =
    (typeof message?.conversation === "string" && message.conversation) ||
    (typeof message?.extendedTextMessage?.text === "string" && message.extendedTextMessage.text) ||
    ""

  return {
    fromMe: key?.fromMe === true,
    remoteJid: String(key?.remoteJid ?? key?.remoteJidAlt ?? ""),
    texto: String(texto),
    pushName: data?.pushName != null ? String(data.pushName) : null,
  }
}

/**
 * Descobre qual campanha vinculada ao lead disparou a mensagem mais recente.
 * Usado como critério de desempate quando o lead está em mais de uma campanha.
 */
async function campanhaDaUltimaMensagem(leadId: string, campanhaIds: string[]): Promise<string | null> {
  if (campanhaIds.length === 0) return null
  if (campanhaIds.length === 1) return campanhaIds[0]

  const ultima = await prisma.timelineEvent.findFirst({
    where: {
      leadId,
      tipo: "mensagem_enviada",
      campanhaId: { in: campanhaIds },
    },
    orderBy: { data: "desc" },
    select: { campanhaId: true },
  })

  // Sem histórico de envio? Cai na campanha vinculada mais recentemente.
  return ultima?.campanhaId ?? campanhaIds[0]
}

export async function processarRespostaLead(payload: unknown): Promise<RespostaLeadResultado> {
  const msg = extrairMensagem(payload)

  // 1. Só registramos a resposta quando a mensagem partiu do lead. Mensagens
  //    enviadas pelo próprio número monitorado chegam com fromMe === true e
  //    devem ser ignoradas aqui.
  if (msg.fromMe) {
    return { ok: false, motivo: "Ignorado: mensagem enviada por nós (fromMe = true)." }
  }

  // 2. Telefone do lead a partir do remoteJid.
  const telefone = telefoneDoRemoteJid(msg.remoteJid)
  if (!telefone) {
    await recordAppLog({
      nivel: "aviso",
      origem: "inbound-webhook",
      mensagem: "Evento RespostaLead sem remoteJid válido.",
      detalhes: `remoteJid="${msg.remoteJid}"`,
    })
    return { ok: false, motivo: "remoteJid ausente ou inválido." }
  }

  // 3. Localiza o lead. Filtra no banco pelos 8 dígitos finais e confirma o núcleo.
  const ultimos8 = telefone.slice(-8)
  const candidatos = await prisma.lead.findMany({
    where: { telefone: { contains: ultimos8 } },
    select: { id: true, nome: true, telefone: true, status: true, campanhaId: true },
  })
  const lead = candidatos.find((c) => telefonesBatem(c.telefone, telefone)) ?? null

  if (!lead) {
    await recordAppLog({
      nivel: "aviso",
      origem: "inbound-webhook",
      mensagem: "Evento RespostaLead sem lead correspondente.",
      detalhes: `telefone=${telefone} pushName=${msg.pushName ?? "-"}`,
    })
    return { ok: false, motivo: "Nenhum lead encontrado para o telefone." }
  }

  // 4. Campanhas do lead e desempate pela última mensagem enviada.
  const vinculos = await prisma.leadCampaign.findMany({
    where: { leadId: lead.id },
    orderBy: { criadoEm: "desc" },
    select: { campanhaId: true },
  })
  const campanhaIds = vinculos.map((v) => v.campanhaId)
  const campanhaAlvoId =
    (await campanhaDaUltimaMensagem(lead.id, campanhaIds)) ?? lead.campanhaId ?? null

  const campanhaAlvo = campanhaAlvoId
    ? await prisma.campaign.findUnique({ where: { id: campanhaAlvoId }, select: { id: true, nome: true } })
    : null

  /*
   * Descobre a última mensagem efetivamente enviada ao lead para atribuir a ela
   * esta resposta. Sem isso, o evento `resposta` fica sem `mensagemId` e o
   * relatório "Mensagens com melhor retorno" (que agrupa respostas por mensagem)
   * conta zero para todas, exibindo sempre 0,0% de taxa de resposta.
   */
  const ultimaMensagemEnviada = await prisma.timelineEvent.findFirst({
    where: {
      leadId: lead.id,
      tipo: "mensagem_enviada",
      mensagemId: { not: null },
      ...(campanhaAlvo?.id ? { campanhaId: campanhaAlvo.id } : {}),
    },
    orderBy: { data: "desc" },
    select: { mensagemId: true },
  })
  const mensagemRespondidaId = ultimaMensagemEnviada?.mensagemId ?? null

  const textoResposta = msg.texto.trim() || "(mensagem sem texto)"
  const agora = new Date()

  // 5. Registra a resposta na timeline (aparece no feed de eventos com o texto,
  //    o lead e a campanha vinculada). Vincula à mensagem que originou a
  //    resposta para alimentar o relatório de retorno por mensagem.
  await prisma.timelineEvent.create({
    data: {
      leadId: lead.id,
      campanhaId: campanhaAlvo?.id ?? null,
      mensagemId: mensagemRespondidaId,
      tipo: "resposta",
      descricao: `${lead.nome} respondeu no WhatsApp.`,
      detalhes: `Resposta: "${textoResposta}"`,
      data: agora,
      sucesso: true,
    },
  })

  // 6. Marca como qualificado e registra o evento correspondente. Mesmo que o
  //    lead esteja em várias campanhas, a qualificação é atribuída à campanha
  //    que enviou a última mensagem (campanhaAlvo) e ele sai de todas.
  await prisma.timelineEvent.create({
    data: {
      leadId: lead.id,
      campanhaId: campanhaAlvo?.id ?? null,
      tipo: "qualificado",
      descricao: campanhaAlvo
        ? `Lead qualificado pela campanha ${campanhaAlvo.nome}.`
        : "Lead qualificado após responder no WhatsApp.",
      detalhes:
        campanhaIds.length > 1
          ? `Removido de ${campanhaIds.length} campanhas após qualificação.`
          : campanhaAlvo
            ? `Removido da campanha ${campanhaAlvo.nome}.`
            : null,
      data: agora,
      sucesso: true,
    },
  })

  // 7. Remove o lead de TODAS as campanhas em que estava vinculado e zera a
  //    campanha principal, já que ele deixou de participar de qualquer uma.
  await prisma.leadCampaign.deleteMany({ where: { leadId: lead.id } })

  const statusAnterior = lead.status
  const leadAtualizado = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: "qualificado",
      campanhaId: null,
      entradaCampanhaEm: null,
    },
    select: {
      id: true,
      nome: true,
      telefone: true,
      produto: true,
      marca: true,
      persona: true,
      regiao: true,
      status: true,
      campanhaId: true,
      criadoEm: true,
      entradaCampanhaEm: true,
    },
  })

  const leadPayload = {
    id: leadAtualizado.id,
    nome: leadAtualizado.nome,
    telefone: leadAtualizado.telefone,
    produto: leadAtualizado.produto,
    marca: leadAtualizado.marca,
    persona: leadAtualizado.persona,
    regiao: leadAtualizado.regiao,
    status: leadAtualizado.status,
    campanhaId: leadAtualizado.campanhaId,
    criadoEm: leadAtualizado.criadoEm.toISOString(),
    entradaCampanhaEm: leadAtualizado.entradaCampanhaEm?.toISOString() ?? null,
  }

  // 8. Notifica os webhooks de saída assinados.
  await emitWebhookEvent("mensagem.resposta", {
    lead: { id: lead.id, nome: lead.nome, telefone: lead.telefone },
    campanha: campanhaAlvo ? { id: campanhaAlvo.id, nome: campanhaAlvo.nome } : null,
    resposta: textoResposta,
    origem: "whatsapp",
  })
  if (statusAnterior !== "qualificado") {
    await emitWebhookEvent("lead.status_alterado", { lead: leadPayload, statusAnterior })
    await emitWebhookEvent("lead.qualificado", { lead: leadPayload })
  }

  return { ok: true, leadId: lead.id, campanhaId: campanhaAlvo?.id ?? null }
}
