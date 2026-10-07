import "server-only"

import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

/**
 * Armazenamento das mensagens de voz enviadas pelo chat.
 *
 * O áudio NUNCA vai para o banco: o arquivo fica numa pasta do servidor e a timeline
 * guarda apenas o id dele (`Audio: <id>`). Os arquivos são apagados automaticamente
 * depois de `AUDIO_RETENTION_DAYS` dias (padrão 30) — ver `limparAudiosExpirados`,
 * chamada periodicamente por `instrumentation.ts`.
 *
 * Variáveis de ambiente:
 *  - AUDIO_STORAGE_DIR: pasta dos arquivos. Padrão: `<cwd>/data/audios` (no container,
 *    `/app/data/audios`). No Coolify, monte aqui o Persistent Storage.
 *  - AUDIO_RETENTION_DAYS: por quantos dias o áudio é mantido. Padrão: 30.
 */

export const AUDIO_TAMANHO_MAXIMO = 16 * 1024 * 1024 // 16 MB (~30+ min de voz em opus)

const DIAS_PADRAO = 30
const DIA_MS = 24 * 60 * 60 * 1000

/** Formatos aceitos (o navegador grava em webm/opus no Chrome/Firefox e em mp4/aac no Safari). */
const EXTENSOES: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
}

const MIME_POR_EXTENSAO: Record<string, string> = {
  webm: "audio/webm",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  mp3: "audio/mpeg",
  wav: "audio/wav",
}

/** `<uuid>.<ext>` — qualquer coisa fora disso é rejeitada (impede path traversal). */
const ID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webm|ogg|m4a|aac|mp3|wav)$/

export function pastaDeAudios(): string {
  const configurada = process.env.AUDIO_STORAGE_DIR?.trim()
  return path.resolve(configurada || path.join(process.cwd(), "data", "audios"))
}

export function diasDeRetencao(): number {
  const valor = Number(process.env.AUDIO_RETENTION_DAYS)
  return Number.isFinite(valor) && valor > 0 ? valor : DIAS_PADRAO
}

/** Normaliza `audio/webm;codecs=opus` → `audio/webm`. */
function tipoBase(mime: string): string {
  return mime.split(";")[0]?.trim().toLowerCase() ?? ""
}

export function extensaoDoMime(mime: string): string | null {
  return EXTENSOES[tipoBase(mime)] ?? null
}

export function idDeAudioValido(id: string): boolean {
  return ID_VALIDO.test(id)
}

export function mimeDoAudio(id: string): string {
  const extensao = id.split(".").pop() ?? ""
  return MIME_POR_EXTENSAO[extensao] ?? "application/octet-stream"
}

export function caminhoDoAudio(id: string): string | null {
  if (!idDeAudioValido(id)) return null
  return path.join(pastaDeAudios(), id)
}

/** Grava o áudio na pasta do servidor e devolve o id (nome do arquivo). */
export async function salvarAudio(dados: Buffer, mime: string): Promise<string> {
  const extensao = extensaoDoMime(mime)
  if (!extensao) throw new Error("Formato de áudio não suportado.")
  const pasta = pastaDeAudios()
  await mkdir(pasta, { recursive: true })
  const id = `${randomUUID()}.${extensao}`
  await writeFile(path.join(pasta, id), dados, { flag: "wx" })
  return id
}

export async function removerAudio(id: string): Promise<void> {
  const caminho = caminhoDoAudio(id)
  if (!caminho) return
  await unlink(caminho).catch(() => undefined)
}

/** Síncrono e barato: usado ao montar o histórico para saber se o arquivo ainda existe. */
export function audioExiste(id: string): boolean {
  const caminho = caminhoDoAudio(id)
  return caminho ? existsSync(caminho) : false
}

/**
 * Apaga os áudios mais velhos que o período de retenção (pela data de gravação do arquivo).
 * Só toca em arquivos com o formato de id que o app gera, então é seguro mesmo se a pasta
 * for compartilhada com outra coisa.
 */
export async function limparAudiosExpirados(): Promise<{ removidos: number; liberadoBytes: number }> {
  const pasta = pastaDeAudios()
  let nomes: string[]
  try {
    nomes = await readdir(pasta)
  } catch {
    return { removidos: 0, liberadoBytes: 0 } // pasta ainda não existe: nenhum áudio foi enviado
  }

  const limite = Date.now() - diasDeRetencao() * DIA_MS
  let removidos = 0
  let liberadoBytes = 0

  for (const nome of nomes) {
    if (!idDeAudioValido(nome)) continue
    const caminho = path.join(pasta, nome)
    try {
      const info = await stat(caminho)
      if (!info.isFile() || info.mtimeMs > limite) continue
      await unlink(caminho)
      removidos += 1
      liberadoBytes += info.size
    } catch {
      // Arquivo sumiu ou está em uso: tenta de novo na próxima varredura.
    }
  }

  return { removidos, liberadoBytes }
}
