import "server-only"

import { randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, stat, unlink, writeFile, copyFile } from "node:fs/promises"
import path from "node:path"

import { extensaoDoNome, mimeDoArquivo, nomeSeguro, tipoPorMime } from "@/lib/arquivo-storage"
import type { CampanhaAnexo } from "@/types"

/**
 * Imagens, vídeos e arquivos anexados às mensagens de CAMPANHA.
 *
 * Diferente do chat (que envia na hora e não guarda nada), a campanha dispara depois — por dias,
 * para vários leads —, então o arquivo precisa existir até o último envio. Por isso ele fica num
 * VOLUME do servidor, NUNCA no banco: a mensagem guarda só a referência (`anexoId`, tipo, mime,
 * nome, tamanho). Não há pré-visualização no painel.
 *
 * Retenção (ver `aplicarRetencaoAnexos`, chamada de hora em hora por `instrumentation.ts`):
 *  - campanha ATIVA ou PAUSADA: o arquivo fica disponível por até 30 dias, contados do upload;
 *  - campanha em RASCUNHO ou ENCERRADA: o arquivo é removido em até 10 dias, contados da última
 *    alteração da campanha;
 *  - campanha EXCLUÍDA: o arquivo é removido na hora (`deleteCampaign`);
 *  - mensagem removida/anexo trocado: removido ao salvar a campanha;
 *  - upload que nunca foi salvo numa campanha: removido após 24h.
 *
 * Variáveis de ambiente:
 *  - CAMPANHA_ANEXO_DIR: pasta dos arquivos — monte o volume aqui. Padrão: `<cwd>/data/campanhas`
 *    (no container, `/app/data/campanhas`).
 *  - CAMPANHA_ANEXO_DIAS_ATIVA (padrão 30) e CAMPANHA_ANEXO_DIAS_INATIVA (padrão 10).
 */

export const CAMPANHA_ANEXO_TAMANHO_MAXIMO = 20 * 1024 * 1024 // 20 MB: o arquivo vai em base64 para a Evolution
export const CAMPANHA_LEGENDA_MAXIMA = 1024 // limite de legenda do WhatsApp

const DIA_MS = 24 * 60 * 60 * 1000
const ORFAO_MS = DIA_MS

function diasDeEnv(nome: string, padrao: number): number {
  const valor = Number(process.env[nome])
  return Number.isFinite(valor) && valor > 0 ? valor : padrao
}
const ID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function pastaDeAnexosCampanha(): string {
  const configurada = process.env.CAMPANHA_ANEXO_DIR?.trim()
  return path.resolve(configurada || path.join(process.cwd(), "data", "campanhas"))
}

export function idDeAnexoValido(id: string): boolean {
  return ID_VALIDO.test(id)
}

function caminhoDoAnexo(id: string): string | null {
  return idDeAnexoValido(id) ? path.join(pastaDeAnexosCampanha(), id) : null
}

/** Mesma regra do chat: .jpg/.jpeg/.png/.webp vão como foto; todo o resto como documento (nome e extensão originais). */
export function tipoDoAnexo(mime: string): CampanhaAnexo["tipo"] {
  return tipoPorMime(mime)
}

export async function salvarAnexoCampanha(
  dados: Buffer,
  arquivo: { nome: string; mime: string },
): Promise<CampanhaAnexo> {
  const pasta = pastaDeAnexosCampanha()
  await mkdir(pasta, { recursive: true })
  const id = randomUUID()
  await writeFile(path.join(pasta, id), dados, { flag: "wx" })

  const mime = mimeDoArquivo(arquivo.mime, arquivo.nome)
  const tipo = tipoDoAnexo(mime)
  let nome = nomeSeguro(arquivo.nome, tipo === "imagem" ? "imagem" : "arquivo")
  if (!extensaoDoNome(nome) && tipo === "imagem") nome = `${nome}.${mime === "image/jpeg" ? "jpg" : mime.split("/")[1]}`
  return { id, tipo, mime, nome, tamanho: dados.length }
}

/** Tamanho real do arquivo no servidor (`null` se não existe): o app não confia no que o navegador informa. */
export async function tamanhoDoAnexoCampanha(id: string): Promise<number | null> {
  const caminho = caminhoDoAnexo(id)
  if (!caminho) return null
  try {
    const info = await stat(caminho)
    return info.isFile() ? info.size : null
  } catch {
    return null
  }
}

/** Lê o conteúdo na hora do envio. `null` se o arquivo não está mais no servidor. */
export async function lerAnexoCampanha(id: string): Promise<Buffer | null> {
  const caminho = caminhoDoAnexo(id)
  if (!caminho) return null
  try {
    return await readFile(caminho)
  } catch {
    return null
  }
}

export async function removerAnexoCampanha(id: string | null | undefined): Promise<void> {
  const caminho = id ? caminhoDoAnexo(id) : null
  if (!caminho) return
  await unlink(caminho).catch(() => undefined)
}

/** Cópia independente (duplicar campanha): apagar uma não pode quebrar a outra. Devolve o novo id. */
export async function copiarAnexoCampanha(id: string): Promise<string | null> {
  const origem = caminhoDoAnexo(id)
  if (!origem) return null
  const novoId = randomUUID()
  try {
    await copyFile(origem, path.join(pastaDeAnexosCampanha(), novoId))
    return novoId
  } catch {
    return null
  }
}

export interface AnexoEmUso {
  anexoId: string
  campanhaStatus: "ativa" | "pausada" | "encerrada" | "rascunho"
  campanhaAtualizadaEm: Date
}

/**
 * Aplica a retenção a TODOS os arquivos da pasta (ver o cabeçalho deste módulo). `emUso` lista
 * todas as mensagens com anexo, de todas as instâncias. Só toca em arquivos com nome de id gerado
 * pelo app. A referência no banco é mantida: se o arquivo expirar, o envio falha com um aviso claro
 * pedindo para anexar de novo, em vez de seguir sem a mídia.
 */
export async function aplicarRetencaoAnexos(
  emUso: AnexoEmUso[],
): Promise<{ expirados: number; orfaos: number }> {
  const pasta = pastaDeAnexosCampanha()
  let nomes: string[]
  try {
    nomes = await readdir(pasta)
  } catch {
    return { expirados: 0, orfaos: 0 }
  }

  const agora = Date.now()
  const limiteViva = diasDeEnv("CAMPANHA_ANEXO_DIAS_ATIVA", 30) * DIA_MS
  const limiteInativa = diasDeEnv("CAMPANHA_ANEXO_DIAS_INATIVA", 10) * DIA_MS
  const porId = new Map(emUso.map((a) => [a.anexoId, a]))

  let expirados = 0
  let orfaos = 0
  for (const nome of nomes) {
    if (!idDeAnexoValido(nome)) continue
    const caminho = path.join(pastaDeAnexosCampanha(), nome)
    try {
      const info = await stat(caminho)
      if (!info.isFile()) continue
      const idade = agora - info.mtimeMs
      const dono = porId.get(nome)

      if (!dono) {
        // Ninguém referencia: upload abandonado. Espera 24h para não apagar um upload que ainda vai ser salvo.
        if (idade > ORFAO_MS) {
          await unlink(caminho)
          orfaos += 1
        }
        continue
      }

      const viva = dono.campanhaStatus === "ativa" || dono.campanhaStatus === "pausada"
      const vencido = viva
        ? idade > limiteViva
        : agora - dono.campanhaAtualizadaEm.getTime() > limiteInativa
      if (vencido) {
        await unlink(caminho)
        expirados += 1
      }
    } catch {
      // Sumiu ou está em uso: tenta na próxima varredura.
    }
  }
  return { expirados, orfaos }
}
