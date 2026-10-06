import {
  ARQUIVO_TAMANHO_MAXIMO,
  extensaoDoMimeArquivo,
  extensaoDoNome,
  linhaDeArquivo,
  mimeLimpo,
  nomeSeguro,
  salvarArquivo,
  type ArquivoMeta,
  type TipoArquivo,
} from "@/lib/arquivo-storage"
import { recordAppLog } from "@/services/app-logs"
import { baixarMidiaDaEvolution } from "@/services/evolution"
import type { MensagemRecebida } from "@/services/lead-response"

/**
 * Imagens e arquivos RECEBIDOS dos leads.
 *
 * Não há prévia nem armazenamento definitivo: o conteúdo é baixado na Evolution e fica na pasta
 * temporária (`lib/arquivo-storage.ts`) só até alguém clicar em "Baixar" no chat — aí o arquivo é
 * apagado. A timeline guarda os metadados na linha `Arquivo: <id>;<tipo>;<mime>;<bytes>;<nome>`.
 */

const MEMORIA_MS = 10 * 60 * 1000

const ICONES: Record<TipoArquivo, string> = { imagem: "🖼️", documento: "📎", video: "🎬" }
const ROTULOS: Record<TipoArquivo, string> = { imagem: "Imagem", documento: "Arquivo", video: "Vídeo" }

export interface ResultadoArquivoRecebido {
  meta: ArquivoMeta | null
  /** Quando não foi possível guardar: o motivo, em texto curto para o chat. */
  motivo: string | null
}

declare global {
  // eslint-disable-next-line no-var
  var __arquivosRecebidos: Map<string, { promessa: Promise<ResultadoArquivoRecebido>; expiraEm: number }> | undefined
}

export function iconeDoTipo(tipo: TipoArquivo): string {
  return ICONES[tipo]
}

/** Texto padrão da mensagem no chat quando não há legenda: ícone + nome do arquivo. */
export function marcadorDoArquivo(tipo: TipoArquivo, nome: string): string {
  return `${ICONES[tipo]} ${nome}`
}

/** Texto da resposta no chat/webhooks: a legenda, se houver, senão o marcador (ou o motivo da falha). */
export function textoDaRespostaEmArquivo(msg: MensagemRecebida, resultado: ResultadoArquivoRecebido): string {
  const arquivo = msg.arquivo
  if (!arquivo) return ""
  if (!resultado.meta) return `${ICONES[arquivo.tipo]} ${ROTULOS[arquivo.tipo]} (${resultado.motivo ?? "não foi possível baixar"})`
  return arquivo.legenda?.trim() || marcadorDoArquivo(resultado.meta.tipo, resultado.meta.nome)
}

/** Linhas `Resposta:` + `Arquivo:` da timeline (a linha `Arquivo:` só existe se o arquivo foi guardado). */
export function detalhesDaRespostaEmArquivo(msg: MensagemRecebida, resultado: ResultadoArquivoRecebido): string {
  const texto = textoDaRespostaEmArquivo(msg, resultado)
  return resultado.meta ? `Resposta: "${texto}"\n${linhaDeArquivo(resultado.meta)}` : `Resposta: "${texto}"`
}

async function baixarEGuardar(msg: MensagemRecebida): Promise<ResultadoArquivoRecebido> {
  const arquivo = msg.arquivo
  if (!arquivo) return { meta: null, motivo: "sem arquivo" }

  const grande = { meta: null, motivo: "grande demais para o painel; abra no WhatsApp" }
  if (arquivo.tamanho && arquivo.tamanho > ARQUIVO_TAMANHO_MAXIMO) return grande

  let dados: Buffer | null = null
  let mime = arquivo.mimetype
  let nomeEvolution: string | null = null

  if (arquivo.base64) {
    dados = Buffer.from(arquivo.base64.replace(/^data:[^;]*;base64,/, ""), "base64")
    if (dados.length === 0) dados = null
  }
  if (!dados) {
    const baixado = await baixarMidiaDaEvolution({ instancia: msg.instancia, key: msg.bruto.key, message: msg.bruto.message })
    if (!baixado.ok) return { meta: null, motivo: "não foi possível baixar" }
    dados = baixado.dados
    mime = baixado.mimetype ?? mime
    nomeEvolution = baixado.nome
  }

  if (dados.length > ARQUIVO_TAMANHO_MAXIMO) return grande

  const mimeFinal = mimeLimpo(mime)
  const ext = extensaoDoMimeArquivo(mimeFinal)
  const padrao = `${ROTULOS[arquivo.tipo].toLowerCase()}${ext ? `.${ext}` : ""}`
  let nome = nomeSeguro(arquivo.nome ?? nomeEvolution, padrao)
  if (ext && !extensaoDoNome(nome) && arquivo.tipo !== "documento") nome = `${nome}.${ext}`

  try {
    const id = await salvarArquivo(dados)
    return { meta: { id, tipo: arquivo.tipo, mime: mimeFinal, tamanho: dados.length, nome }, motivo: null }
  } catch (error) {
    await recordAppLog({
      nivel: "erro",
      origem: "chat",
      mensagem: "Falha ao gravar o arquivo recebido na pasta temporária do servidor.",
      detalhes: error,
    })
    return { meta: null, motivo: "não foi possível guardar" }
  }
}

/**
 * Baixa a imagem/arquivo da mensagem recebida e o deixa na pasta temporária. Nunca lança. Chamado
 * mais de uma vez para a mesma mensagem (fluxo de resposta e bots), devolve o mesmo resultado.
 */
export async function guardarArquivoRecebido(msg: MensagemRecebida): Promise<ResultadoArquivoRecebido> {
  if (!msg.arquivo) return { meta: null, motivo: "sem arquivo" }

  const memoria = (globalThis.__arquivosRecebidos ??= new Map())
  const agora = Date.now()
  for (const [chave, item] of memoria) if (item.expiraEm <= agora) memoria.delete(chave)

  const chave = msg.messageId ? `${msg.instancia ?? ""}:${msg.messageId}` : null
  const existente = chave ? memoria.get(chave) : undefined
  if (existente) return existente.promessa

  const promessa = baixarEGuardar(msg).catch(async (error): Promise<ResultadoArquivoRecebido> => {
    await recordAppLog({ nivel: "erro", origem: "chat", mensagem: "Falha ao processar o arquivo recebido.", detalhes: error })
    return { meta: null, motivo: "não foi possível baixar" }
  })
  if (chave) {
    memoria.set(chave, { promessa, expiraEm: agora + MEMORIA_MS })
    void promessa.then((r) => {
      if (!r.meta) memoria.delete(chave)
    })
  }
  return promessa
}
