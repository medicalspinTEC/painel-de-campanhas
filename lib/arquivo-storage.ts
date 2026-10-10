import "server-only"

import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { pastaDeAudios } from "@/lib/audio-storage"

/**
 * Imagens e arquivos RECEBIDOS dos leads — guardados só de passagem.
 *
 * O app não mantém esses arquivos: o webhook baixa o conteúdo na Evolution e o deixa numa pasta
 * do servidor só até alguém clicar em "Baixar" no chat. No instante em que o download termina, o
 * arquivo é apagado (ver `app/api/chat/arquivo/[id]/route.ts`). Quem nunca baixa não ocupa espaço
 * para sempre: `limparArquivosExpirados` apaga o que passar de `ARQUIVO_RETENTION_DAYS` dias.
 * Não há prévia nem visualização no painel.
 *
 * A timeline guarda só os metadados, numa linha `Arquivo: <id>;<tipo>;<mime>;<bytes>;<nome>`.
 *
 * Variáveis de ambiente:
 *  - ARQUIVO_STORAGE_DIR: pasta dos arquivos. Padrão: a subpasta `arquivos` da pasta de áudios
 *    (no container, `/app/data/audios/arquivos`, dentro do Persistent Storage já montado).
 *  - ARQUIVO_RETENTION_DAYS: dias até apagar um arquivo que ninguém baixou. Padrão: 7.
 */

export const ARQUIVO_TAMANHO_MAXIMO = 160 * 1024 * 1024 // 160 MB (limite de imagem do WhatsApp)

const DIAS_PADRAO = 7
const DIA_MS = 24 * 60 * 60 * 1000

export type TipoArquivo = "imagem" | "documento" | "video"

const ID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function pastaDeArquivos(): string {
  const configurada = process.env.ARQUIVO_STORAGE_DIR?.trim()
  return path.resolve(configurada || path.join(pastaDeAudios(), "arquivos"))
}

export function diasDeRetencaoArquivos(): number {
  const valor = Number(process.env.ARQUIVO_RETENTION_DAYS)
  return Number.isFinite(valor) && valor > 0 ? valor : DIAS_PADRAO
}

export function idDeArquivoValido(id: string): boolean {
  return ID_VALIDO.test(id)
}

export function caminhoDoArquivo(id: string): string | null {
  return idDeArquivoValido(id) ? path.join(pastaDeArquivos(), id) : null
}

/** Nome seguro para exibir e para o download: sem pastas, sem quebra de linha, sem `;`. */
export function nomeSeguro(nome: string | null | undefined, padrao: string): string {
  const limpo = String(nome ?? "")
    .replace(/[\\/\r\n\t;"]+/g, "_")
    .replace(/[\u0000-\u001f]/g, "")
    .trim()
  if (limpo.length <= 120) return limpo || padrao
  // Nome longo: corta o miolo, mas mantém a extensão original (senão o arquivo chega sem "tipo").
  const m = /\.[a-z0-9]{1,8}$/i.exec(limpo)
  const ext = m ? m[0] : ""
  return `${limpo.slice(0, 120 - ext.length)}${ext}`
}

export function extensaoDoNome(nome: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(nome)
  return m ? m[1].toLowerCase() : ""
}

const EXTENSAO_POR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/3gpp": "3gp",
  "video/webm": "webm",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
}

/**
 * Só estas imagens vão/chegam como FOTO no WhatsApp (.jpg, .jpeg, .png e .webp). Qualquer outro
 * tipo — gif, heic, vídeo, pdf, planilha… — vai e chega como DOCUMENTO, com o nome e a extensão
 * originais.
 */
const IMAGENS_COMO_FOTO = new Set(["image/jpeg", "image/png", "image/webp"])

const MIME_POR_EXTENSAO: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}

/** Tipo de envio/recebimento: foto para jpg/jpeg/png/webp, documento para todo o resto. */
export function tipoPorMime(mime: string | null | undefined): "imagem" | "documento" {
  return IMAGENS_COMO_FOTO.has(mimeLimpo(mime)) ? "imagem" : "documento"
}

/**
 * Mime do arquivo escolhido. Alguns navegadores/celulares não informam o tipo (ou mandam
 * `image/jpg`): nesse caso vale a extensão do nome para jpg/jpeg/png/webp.
 */
export function mimeDoArquivo(mime: string | null | undefined, nome: string | null | undefined): string {
  const limpo = mimeLimpo(mime)
  if (limpo === "image/jpg" || limpo === "image/pjpeg") return "image/jpeg"
  if (limpo !== "application/octet-stream") return limpo
  return MIME_POR_EXTENSAO[extensaoDoNome(String(nome ?? ""))] ?? limpo
}

export function extensaoDoMimeArquivo(mime: string | null | undefined): string {
  return EXTENSAO_POR_MIME[(mime ?? "").split(";")[0].trim().toLowerCase()] ?? ""
}

/** Mime sem parâmetros e sem `;`/espaços, para caber na linha `Arquivo:`. */
export function mimeLimpo(mime: string | null | undefined): string {
  const base = (mime ?? "").split(";")[0].trim().toLowerCase()
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(base) ? base : "application/octet-stream"
}

export async function salvarArquivo(dados: Buffer): Promise<string> {
  const pasta = pastaDeArquivos()
  await mkdir(pasta, { recursive: true })
  const id = randomUUID()
  await writeFile(path.join(pasta, id), dados, { flag: "wx" })
  return id
}

export async function removerArquivo(id: string): Promise<void> {
  const caminho = caminhoDoArquivo(id)
  if (!caminho) return
  await unlink(caminho).catch(() => undefined)
}

/** Síncrono e barato: usado ao montar o histórico para saber se o arquivo ainda está lá. */
export function arquivoExiste(id: string): boolean {
  const caminho = caminhoDoArquivo(id)
  return caminho ? existsSync(caminho) : false
}

/** Apaga o que ninguém baixou dentro do prazo. Só toca em arquivos com nome de id gerado pelo app. */
export async function limparArquivosExpirados(): Promise<{ removidos: number; liberadoBytes: number }> {
  const pasta = pastaDeArquivos()
  let nomes: string[]
  try {
    nomes = await readdir(pasta)
  } catch {
    return { removidos: 0, liberadoBytes: 0 }
  }

  const limite = Date.now() - diasDeRetencaoArquivos() * DIA_MS
  let removidos = 0
  let liberadoBytes = 0
  for (const nome of nomes) {
    if (!idDeArquivoValido(nome)) continue
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

/** Linha gravada na timeline: `Arquivo: <id>;<tipo>;<mime>;<bytes>;<nome>`. */
export function linhaDeArquivo(meta: { id: string; tipo: TipoArquivo; mime: string; tamanho: number; nome: string }): string {
  return `Arquivo: ${meta.id};${meta.tipo};${mimeLimpo(meta.mime)};${meta.tamanho};${nomeSeguro(meta.nome, "arquivo")}`
}

export interface ArquivoMeta {
  id: string
  tipo: TipoArquivo
  mime: string
  tamanho: number
  nome: string
}

/** Lê a linha `Arquivo:` dos detalhes de um evento. */
export function lerLinhaDeArquivo(detalhes: string | null | undefined): ArquivoMeta | null {
  const m = /(?:^|\n)Arquivo:\s*([0-9a-f-]{36});(imagem|documento|video);([^;\s]+);(\d+);([^\n]*)\s*$/.exec(detalhes ?? "")
  if (!m) return null
  return { id: m[1], tipo: m[2] as TipoArquivo, mime: m[3], tamanho: Number(m[4]), nome: m[5].trim() }
}
