import "server-only"

import { randomUUID } from "node:crypto"
import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { mimeLimpo, nomeSeguro, type TipoArquivo } from "@/lib/arquivo-storage"
import { pastaDeAudios } from "@/lib/audio-storage"

/**
 * Imagens e arquivos anexados a MENSAGENS DE CAMPANHA — mesmo modelo do chat: o conteúdo NUNCA vai
 * para o banco e não existe pré-visualização no painel.
 *
 * Diferença para o chat: no chat o arquivo é enviado na hora e descartado. Na campanha o envio só
 * acontece depois (a engine dispara por dia/horário, para vários leads), então o arquivo precisa
 * ficar numa pasta do servidor até a campanha terminar. No banco fica só uma linha de referência
 * (`midia`): `<id>;<tipo>;<mime>;<bytes>;<nome>` — o mesmo formato da linha `Arquivo:` do chat.
 *
 * Ciclo de vida:
 *  - upload (ação do editor) grava o arquivo e devolve a referência;
 *  - a referência só é gravada no banco quando a campanha é salva;
 *  - arquivo que ninguém referencia (anexo trocado, campanha apagada, editor abandonado) é apagado
 *    por `limparMidiasOrfas`, chamada de hora em hora por `instrumentation.ts`.
 *
 * Variável de ambiente: CAMPANHA_MIDIA_STORAGE_DIR. Padrão: subpasta `campanhas` da pasta de áudios
 * (no container, `/app/data/audios/campanhas`, dentro do Persistent Storage já montado).
 */

/** O upload passa pela Server Action (limite de 20 MB em next.config.mjs). */
export const CAMPANHA_MIDIA_TAMANHO_MAXIMO = 16 * 1024 * 1024

/** Quanto tempo um arquivo recém-enviado pode ficar sem referência (tempo de preencher o editor). */
const CARENCIA_ORFA_MS = 24 * 60 * 60 * 1000

const ID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface CampanhaMidiaMeta {
  id: string
  tipo: TipoArquivo
  mime: string
  tamanho: number
  nome: string
}

export function pastaDeMidiasDeCampanha(): string {
  const configurada = process.env.CAMPANHA_MIDIA_STORAGE_DIR?.trim()
  return path.resolve(configurada || path.join(pastaDeAudios(), "campanhas"))
}

function caminhoDaMidia(id: string): string | null {
  return ID_VALIDO.test(id) ? path.join(pastaDeMidiasDeCampanha(), id) : null
}

export function linhaDeMidia(meta: CampanhaMidiaMeta): string {
  return `${meta.id};${meta.tipo};${mimeLimpo(meta.mime)};${meta.tamanho};${nomeSeguro(meta.nome, "arquivo")}`
}

/** Lê a referência guardada na campanha. Devolve null se estiver vazia ou malformada. */
export function lerLinhaDeMidia(linha: string | null | undefined): CampanhaMidiaMeta | null {
  const m = /^([0-9a-f-]{36});(imagem|documento|video);([^;\s]+);(\d+);([^\n]*)$/.exec((linha ?? "").trim())
  if (!m || !ID_VALIDO.test(m[1])) return null
  return { id: m[1], tipo: m[2] as TipoArquivo, mime: m[3], tamanho: Number(m[4]), nome: m[5].trim() }
}

/** Grava o arquivo no servidor e devolve a referência a ser guardada na campanha. */
export async function salvarMidiaDeCampanha(arquivo: { dados: Buffer; nome: string; mime: string }): Promise<CampanhaMidiaMeta> {
  const mime = mimeLimpo(arquivo.mime)
  const ehImagem = /^image\/(jpeg|png|webp|gif)$/.test(mime)
  const pasta = pastaDeMidiasDeCampanha()
  await mkdir(pasta, { recursive: true })
  const id = randomUUID()
  await writeFile(path.join(pasta, id), arquivo.dados, { flag: "wx" })
  return {
    id,
    tipo: ehImagem ? "imagem" : "documento",
    mime,
    tamanho: arquivo.dados.length,
    nome: nomeSeguro(arquivo.nome, ehImagem ? "imagem" : "arquivo"),
  }
}

/** Lê o arquivo para o envio. Devolve null se ele não está mais no servidor. */
export async function lerMidiaDeCampanha(meta: CampanhaMidiaMeta): Promise<Buffer | null> {
  const caminho = caminhoDaMidia(meta.id)
  if (!caminho) return null
  try {
    return await readFile(caminho)
  } catch {
    return null
  }
}

/** Cópia independente (duplicar campanha): apagar uma não pode quebrar a outra. */
export async function copiarMidiaDeCampanha(linha: string | null | undefined): Promise<string | null> {
  const meta = lerLinhaDeMidia(linha)
  const origem = meta ? caminhoDaMidia(meta.id) : null
  if (!meta || !origem) return null
  const novoId = randomUUID()
  try {
    await copyFile(origem, path.join(pastaDeMidiasDeCampanha(), novoId))
  } catch {
    return null
  }
  return linhaDeMidia({ ...meta, id: novoId })
}

export async function removerMidiaDeCampanha(linha: string | null | undefined): Promise<void> {
  const meta = lerLinhaDeMidia(linha)
  const caminho = meta ? caminhoDaMidia(meta.id) : null
  if (caminho) await unlink(caminho).catch(() => undefined)
}

/**
 * Apaga os arquivos da pasta que nenhuma campanha referencia mais (e que já passaram da carência).
 * `referenciados` = ids de todas as referências `midia` existentes no banco.
 */
export async function limparMidiasOrfas(referenciados: Set<string>): Promise<{ removidos: number; liberadoBytes: number }> {
  const pasta = pastaDeMidiasDeCampanha()
  let nomes: string[]
  try {
    nomes = await readdir(pasta)
  } catch {
    return { removidos: 0, liberadoBytes: 0 }
  }
  const limite = Date.now() - CARENCIA_ORFA_MS
  let removidos = 0
  let liberadoBytes = 0
  for (const nome of nomes) {
    if (!ID_VALIDO.test(nome) || referenciados.has(nome)) continue
    const caminho = path.join(pasta, nome)
    try {
      const info = await stat(caminho)
      if (!info.isFile() || info.mtimeMs > limite) continue
      await unlink(caminho)
      removidos += 1
      liberadoBytes += info.size
    } catch {
      // Sumiu ou está em uso: tenta na próxima varredura.
    }
  }
  return { removidos, liberadoBytes }
}
