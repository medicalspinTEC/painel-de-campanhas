import { AUDIO_TAMANHO_MAXIMO, extensaoDoMime, salvarAudio } from "@/lib/audio-storage"
import { recordAppLog } from "@/services/app-logs"
import { baixarMidiaDaEvolution } from "@/services/evolution"
import type { MensagemRecebida } from "@/services/lead-response"

/**
 * Mensagens de voz RECEBIDAS dos leads.
 *
 * Segue o mesmo desenho das enviadas pelo chat (ver `sendLeadAudio`): o arquivo vai para a pasta
 * de áudios do servidor (`lib/audio-storage.ts`, AUDIO_STORAGE_DIR = /app/data/audios) e a
 * timeline guarda só o id dele numa linha `Audio: <id>`, que o chat usa para montar o player.
 * Nada de áudio vai para o banco.
 */

export const TEXTO_AUDIO_RECEBIDO = "🎤 Mensagem de voz"
const TEXTO_AUDIO_INDISPONIVEL = "🎤 Mensagem de voz (não foi possível baixar o áudio)"

/** Quanto tempo lembramos de um áudio já guardado (evita baixar de novo se o webhook se repetir). */
const MEMORIA_MS = 10 * 60 * 1000

declare global {
  // eslint-disable-next-line no-var
  var __audiosRecebidos: Map<string, { promessa: Promise<string | null>; expiraEm: number }> | undefined
}

/**
 * Texto da linha `Resposta:` + a linha `Audio:`, no formato que o chat entende. Os dois caminhos
 * que registram a resposta do lead (fluxo de resposta e bots) usam esta função: com o mesmo id de
 * áudio, o detalhe sai idêntico e a checagem de duplicidade dos bots continua funcionando.
 */
export function detalhesDaRespostaEmAudio(audioId: string | null): string {
  return audioId
    ? `Resposta: "${TEXTO_AUDIO_RECEBIDO}"\nAudio: ${audioId}`
    : `Resposta: "${TEXTO_AUDIO_INDISPONIVEL}"`
}

export function textoDaRespostaEmAudio(audioId: string | null): string {
  return audioId ? TEXTO_AUDIO_RECEBIDO : TEXTO_AUDIO_INDISPONIVEL
}

async function baixarEGuardar(msg: MensagemRecebida): Promise<string | null> {
  const audio = msg.audio
  if (!audio) return null

  let dados: Buffer | null = null
  let mime = audio.mimetype

  // Se a Evolution já mandou o base64 no próprio webhook, não precisa buscar.
  if (audio.base64) {
    dados = Buffer.from(audio.base64.replace(/^data:[^;]*;base64,/, ""), "base64")
    if (dados.length === 0) dados = null
  }

  if (!dados) {
    const baixado = await baixarMidiaDaEvolution({
      instancia: msg.instancia,
      key: msg.bruto.key,
      message: msg.bruto.message,
    })
    if (!baixado.ok) return null
    dados = baixado.dados
    mime = baixado.mimetype ?? mime
  }

  if (dados.length > AUDIO_TAMANHO_MAXIMO) {
    await recordAppLog({
      nivel: "aviso",
      origem: "chat",
      mensagem: "Áudio recebido maior que o limite e não foi guardado.",
      detalhes: `tamanho=${dados.length} limite=${AUDIO_TAMANHO_MAXIMO} remoteJid=${msg.remoteJid}`,
    })
    return null
  }

  // Nota de voz do WhatsApp é ogg/opus; se a Evolution não informou o tipo, assume isso.
  const mimeFinal = !mime ? "audio/ogg" : extensaoDoMime(mime) ? mime : null
  if (!mimeFinal) {
    await recordAppLog({
      nivel: "aviso",
      origem: "chat",
      mensagem: "Áudio recebido em formato não suportado.",
      detalhes: `mimetype=${mime} remoteJid=${msg.remoteJid}`,
    })
    return null
  }

  try {
    return await salvarAudio(dados, mimeFinal)
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "chat",
      mensagem: "Falha ao gravar o áudio recebido na pasta de áudios do servidor.",
      detalhes: error,
    })
    return null
  }
}

/**
 * Baixa o áudio da mensagem recebida e o guarda na pasta de áudios; devolve o id do arquivo
 * (ou `null` se não deu). Nunca lança. Chamado mais de uma vez para a mesma mensagem (o fluxo
 * de resposta e os bots recebem o mesmo webhook), devolve o mesmo id sem baixar de novo.
 */
export async function guardarAudioRecebido(msg: MensagemRecebida): Promise<string | null> {
  if (!msg.audio) return null

  const memoria = (globalThis.__audiosRecebidos ??= new Map())
  const agora = Date.now()
  for (const [chave, item] of memoria) if (item.expiraEm <= agora) memoria.delete(chave)

  const chave = msg.messageId ? `${msg.instancia ?? ""}:${msg.messageId}` : null
  const existente = chave ? memoria.get(chave) : undefined
  if (existente) return existente.promessa

  const promessa = baixarEGuardar(msg).catch(async (error) => {
    await recordAppLog({ nivel: "erro", origem: "chat", mensagem: "Falha ao processar o áudio recebido.", detalhes: error })
    return null
  })
  if (chave) {
    memoria.set(chave, { promessa, expiraEm: agora + MEMORIA_MS })
    // Falhou: não guarda a falha, para uma nova entrega do webhook poder tentar de novo.
    void promessa.then((id) => {
      if (!id) memoria.delete(chave)
    })
  }
  return promessa
}
