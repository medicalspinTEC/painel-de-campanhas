import "server-only"

import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { diasDeRetencaoArquivos, extensaoDoMimeArquivo, idDeArquivoValido, mimeLimpo, nomeSeguro, pastaDeArquivos, type TipoArquivo } from "@/lib/arquivo-storage"

/**
 * Imagens e arquivos do CHAT INTERNO (equipe) — guardados só de passagem, como no chat com leads.
 *
 * O conteúdo NUNCA vai para o banco: fica numa pasta do servidor (subpasta `interno` da pasta de
 * arquivos) e é apagado quando todos os outros participantes da conversa baixam (ver
 * `app/api/chat/interno/arquivo/[id]/route.ts`). Quem nunca baixa não ocupa espaço para sempre:
 * `limparAnexosInternosExpirados` apaga o que passar de `ARQUIVO_RETENTION_DAYS` dias. O banco guarda
 * só os metadados (nome, tipo, tamanho) para mostrar o balão na conversa.
 *
 * Variável de ambiente opcional: INTERNO_STORAGE_DIR (padrão: `<pasta de arquivos>/interno`).
 */

export const ANEXO_INTERNO_TAMANHO_MAXIMO = 16 * 1024 * 1024 // 16 MB (cabe no limite de Server Action de 20 MB)

export function pastaDeAnexosInternos(): string {
  const configurada = process.env.INTERNO_STORAGE_DIR?.trim()
  return path.resolve(configurada || path.join(pastaDeArquivos(), "interno"))
}

export function caminhoDoAnexoInterno(id: string): string | null {
  return idDeArquivoValido(id) ? path.join(pastaDeAnexosInternos(), id) : null
}

export function anexoInternoExiste(id: string): boolean {
  const caminho = caminhoDoAnexoInterno(id)
  return caminho ? existsSync(caminho) : false
}

export async function salvarAnexoInterno(dados: Buffer): Promise<string> {
  const pasta = pastaDeAnexosInternos()
  await mkdir(pasta, { recursive: true })
  const id = randomUUID()
  await writeFile(path.join(pasta, id), dados, { flag: "wx" })
  return id
}

export async function removerAnexoInterno(id: string): Promise<void> {
  const caminho = caminhoDoAnexoInterno(id)
  if (!caminho) return
  await unlink(caminho).catch(() => undefined)
}

/** Classifica pelo mime: imagem, vídeo ou documento (qualquer outro arquivo). */
export function tipoDeAnexo(mime: string): TipoArquivo {
  const base = mimeLimpo(mime)
  if (base.startsWith("image/")) return "imagem"
  if (base.startsWith("video/")) return "video"
  return "documento"
}

export function nomeDoAnexo(nome: string | null | undefined, mime: string): string {
  const ext = extensaoDoMimeArquivo(mime)
  return nomeSeguro(nome, ext ? `arquivo.${ext}` : "arquivo")
}

/** Apaga o que ninguém baixou dentro do prazo. Só toca em arquivos com nome de id gerado pelo app. */
export async function limparAnexosInternosExpirados(): Promise<{ removidos: number; liberadoBytes: number }> {
  const pasta = pastaDeAnexosInternos()
  let nomes: string[]
  try {
    nomes = await readdir(pasta)
  } catch {
    return { removidos: 0, liberadoBytes: 0 }
  }
  const limite = Date.now() - diasDeRetencaoArquivos() * 24 * 60 * 60 * 1000
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
