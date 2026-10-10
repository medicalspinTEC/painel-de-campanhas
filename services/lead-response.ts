import { tipoPorMime } from "@/lib/arquivo-storage"
import { prisma } from "@/lib/prisma"
import { recordAppLog } from "@/services/app-logs"
import {
  detalhesDaRespostaEmArquivo,
  guardarArquivoRecebido,
  textoDaRespostaEmArquivo,
} from "@/services/arquivo-recebido"
import { detalhesDaRespostaEmAudio, guardarAudioRecebido, textoDaRespostaEmAudio } from "@/services/audio-recebido"
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
export function telefoneDoRemoteJid(remoteJid: string): string {
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
export function telefonesBatem(a: string, b: string): boolean {
  const da = digitos(a)
  const db = digitos(b)
  if (!da || !db) return false
  if (da === db) return true
  if (da.endsWith(db) || db.endsWith(da)) return true
  return nucleoTelefone(da) === nucleoTelefone(db)
}

export interface MensagemRecebida {
  fromMe: boolean
  remoteJid: string
  texto: string
  pushName: string | null
  /** Id da mensagem no WhatsApp (`data.key.id`). */
  messageId: string | null
  /** Instância da Evolution que recebeu a mensagem (campo `instance` do webhook). */
  instancia: string | null
  /** Preenchido quando a mensagem é uma mensagem de voz / áudio. */
  audio: { mimetype: string | null; segundos: number | null; base64: string | null } | null
  /** Preenchido quando a mensagem é uma imagem, um vídeo ou um arquivo (documento). */
  arquivo: {
    /** Como o painel trata: foto só para jpg/jpeg/png/webp; todo o resto é documento. */
    tipo: "imagem" | "documento" | "video"
    /** O que a mensagem era no WhatsApp (só para dar um nome padrão quando o arquivo não vem com nome). */
    origem: "imagem" | "documento" | "video"
    mimetype: string | null
    nome: string | null
    legenda: string | null
    tamanho: number | null
    base64: string | null
  } | null
  /** `data.key` e `data.message` como vieram, para baixar a mídia na Evolution. */
  bruto: { key: unknown; message: unknown }
}

/** Mensagens "embrulhadas" (temporárias, visualização única…) guardam o conteúdo um nível abaixo. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function desembrulhar(message: any): any {
  let atual = message ?? {}
  for (let i = 0; i < 3; i += 1) {
    const interna =
      atual?.ephemeralMessage?.message ??
      atual?.viewOnceMessage?.message ??
      atual?.viewOnceMessageV2?.message ??
      atual?.deviceSentMessage?.message
    if (!interna) break
    atual = interna
  }
  return atual
}

/**
 * Navega o payload de forma tolerante: o evento pode chegar como o corpo
 * completo do webhook (`{ body: { data: { ... } } }`), como `{ data: { ... } }`
 * ou já como o próprio objeto `data`.
 */
export function extrairMensagem(payload: unknown): MensagemRecebida {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = payload as any
  const data = p?.body?.data ?? p?.data ?? p ?? {}
  const key = data?.key ?? {}
  const message = data?.message ?? {}

  const texto =
    (typeof message?.conversation === "string" && message.conversation) ||
    (typeof message?.extendedTextMessage?.text === "string" && message.extendedTextMessage.text) ||
    ""

  // Mensagem de voz: o WhatsApp manda `audioMessage` (nota de voz tem `ptt: true`).
  const conteudo = desembrulhar(message)
  const audioMsg = conteudo?.audioMessage
  const ehAudio = Boolean(audioMsg) || data?.messageType === "audioMessage"
  const base64Inline = [message?.base64, data?.base64, audioMsg?.base64].find(
    (valor): valor is string => typeof valor === "string" && valor.length > 0,
  )
  const segundos = Number(audioMsg?.seconds)

  // Imagem, vídeo ou documento (com ou sem legenda).
  const documento = conteudo?.documentMessage ?? conteudo?.documentWithCaptionMessage?.message?.documentMessage
  const tipoPorMensagem: Record<string, "imagem" | "documento" | "video"> = {
    imageMessage: "imagem",
    videoMessage: "video",
    documentMessage: "documento",
    documentWithCaptionMessage: "documento",
  }
  const midia: { tipo: "imagem" | "documento" | "video"; m: any } | null = conteudo?.imageMessage
    ? { tipo: "imagem", m: conteudo.imageMessage }
    : documento
      ? { tipo: "documento", m: documento }
      : conteudo?.videoMessage
        ? { tipo: "video", m: conteudo.videoMessage }
        : tipoPorMensagem[String(data?.messageType ?? "")]
          ? { tipo: tipoPorMensagem[String(data.messageType)], m: {} }
          : null
  const tamanhoArquivo = Number(midia?.m?.fileLength)

  const instancia = p?.body?.instance ?? p?.instance ?? data?.instance
  const mimetype = audioMsg?.mimetype ?? message?.mimetype

  return {
    fromMe: key?.fromMe === true,
    remoteJid: String(key?.remoteJid ?? key?.remoteJidAlt ?? ""),
    texto: String(texto),
    pushName: data?.pushName != null ? String(data.pushName) : null,
    messageId: typeof key?.id === "string" && key.id ? key.id : null,
    instancia: typeof instancia === "string" && instancia.trim() ? instancia.trim() : null,
    audio: ehAudio
      ? {
          mimetype: typeof mimetype === "string" && mimetype ? mimetype : null,
          segundos: Number.isFinite(segundos) && segundos > 0 ? segundos : null,
          base64: base64Inline ?? null,
        }
      : null,
    arquivo: midia
      ? {
          // Mesma regra do envio: foto só para jpg/jpeg/png/webp (ou imagem sem mime informado, que
          // no WhatsApp é jpeg); vídeos, gifs, heic e documentos chegam como documento.
          tipo:
            midia.tipo === "imagem" && (!midia.m?.mimetype || tipoPorMime(midia.m.mimetype) === "imagem")
              ? "imagem"
              : "documento",
          origem: midia.tipo,
          mimetype: typeof midia.m?.mimetype === "string" && midia.m.mimetype ? midia.m.mimetype : null,
          nome: typeof (midia.m?.fileName ?? midia.m?.title) === "string" ? String(midia.m.fileName ?? midia.m.title) : null,
          legenda: typeof midia.m?.caption === "string" && midia.m.caption.trim() ? midia.m.caption : null,
          tamanho: Number.isFinite(tamanhoArquivo) && tamanhoArquivo > 0 ? tamanhoArquivo : null,
          base64: base64Inline ?? null,
        }
      : null,
    bruto: { key: data?.key ?? null, message: data?.message ?? null },
  }
}

/** Localiza o lead de um telefone (ignora código do país e 9º dígito). */
export async function localizarLeadPorTelefone(telefone: string) {
  const ultimos8 = digitos(telefone).slice(-8)
  if (!ultimos8) return null
  const candidatos = await prisma.lead.findMany({
    where: { telefone: { contains: ultimos8 } },
    select: { id: true, nome: true, telefone: true, status: true },
  })
  return candidatos.find((c) => telefonesBatem(c.telefone, telefone)) ?? null
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

  // Mensagem de voz: baixa o arquivo na Evolution e guarda na pasta de áudios do servidor; a
  // timeline guarda só o id (`Audio: <id>`), que o chat usa para tocar. Sem áudio, é texto normal.
  const audioId = msg.audio ? await guardarAudioRecebido(msg) : null
  // Imagem/arquivo: fica numa pasta temporária só até alguém baixar (sem prévia); ver `arquivo-recebido`.
  const arquivoGuardado = !msg.audio && msg.arquivo ? await guardarArquivoRecebido(msg) : null
  const textoResposta = msg.audio
    ? textoDaRespostaEmAudio(audioId)
    : arquivoGuardado
      ? textoDaRespostaEmArquivo(msg, arquivoGuardado)
      : msg.texto.trim() || "(mensagem sem texto)"
  const detalhesResposta = msg.audio
    ? detalhesDaRespostaEmAudio(audioId)
    : arquivoGuardado
      ? detalhesDaRespostaEmArquivo(msg, arquivoGuardado)
      : `Resposta: "${textoResposta}"`
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
      detalhes: detalhesResposta,
      data: agora,
      sucesso: true,
    },
  })

  // 6. Se o lead estava em alguma campanha, registra a saída dela como um
  //    evento à parte (tipo "removido_campanha", ícone diferente no feed) —
  //    separado do evento de resposta acima, já que são fatos distintos e nem
  //    toda resposta necessariamente tira o lead de uma campanha.
  if (campanhaIds.length > 0) {
    await prisma.timelineEvent.create({
      data: {
        leadId: lead.id,
        campanhaId: campanhaAlvo?.id ?? null,
        tipo: "removido_campanha",
        descricao:
          campanhaIds.length > 1
            ? `Lead removido de ${campanhaIds.length} campanhas após responder.`
            : `Lead removido da campanha ${campanhaAlvo?.nome ?? ""} após responder.`,
        data: agora,
        sucesso: true,
      },
    })
  }

  // 7. Remove o lead de TODAS as campanhas em que estava vinculado e zera a
  //    campanha principal, já que ele deixou de participar de qualquer uma.
  await prisma.leadCampaign.deleteMany({ where: { leadId: lead.id } })

  const statusAnterior = lead.status
  const leadAtualizado = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: "respondeu",
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
  if (statusAnterior !== "respondeu") {
    await emitWebhookEvent("lead.status_alterado", { lead: leadPayload, statusAnterior })
    await emitWebhookEvent("lead.status_alterado", { lead: leadPayload })
  }

  return { ok: true, leadId: lead.id, campanhaId: campanhaAlvo?.id ?? null }
}
