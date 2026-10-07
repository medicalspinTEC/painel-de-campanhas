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
    .slice(0, 120)
  return limpo || padrao
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
  "video/mp4": "mp4",
  "application/pdf": "pdf",
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
