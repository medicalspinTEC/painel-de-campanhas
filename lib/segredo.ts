import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto"

/**
 * Criptografia de segredos guardados no banco (ex.: chave de API dos Agentes de IA).
 * AES-256-GCM; a chave de criptografia é derivada de `APP_SECRET_KEY` (ou, na falta, do
 * `AUTH_SECRET`/`AUTH_PASSWORD` já usados pelo app). Trocar esse segredo invalida os valores
 * já guardados: o usuário só precisa informar a chave de API de novo.
 *
 * Formato guardado: `v1:<iv>:<tag>:<dados>` (base64). Só servidor.
 */

const PREFIXO = "v1"
let chaveCache: Buffer | null = null

function chave(): Buffer {
  if (chaveCache) return chaveCache
  const base = process.env.APP_SECRET_KEY || process.env.AUTH_SECRET || process.env.AUTH_PASSWORD || "campanhas-dev-secret"
  chaveCache = scryptSync(base, "campanhas.segredo.v1", 32)
  return chaveCache
}

export function criptografar(texto: string): string {
  const iv = randomBytes(12)
  const cifra = createCipheriv("aes-256-gcm", chave(), iv)
  const dados = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()])
  return [PREFIXO, iv.toString("base64"), cifra.getAuthTag().toString("base64"), dados.toString("base64")].join(":")
}

/** `null` quando o valor está vazio, em outro formato ou não abre com a chave atual. */
export function descriptografar(valor: string | null | undefined): string | null {
  if (!valor) return null
  const [prefixo, iv, tag, dados] = valor.split(":")
  if (prefixo !== PREFIXO || !iv || !tag || !dados) return null
  try {
    const decifra = createDecipheriv("aes-256-gcm", chave(), Buffer.from(iv, "base64"))
    decifra.setAuthTag(Buffer.from(tag, "base64"))
    return Buffer.concat([decifra.update(Buffer.from(dados, "base64")), decifra.final()]).toString("utf8")
  } catch {
    return null
  }
}

/** Só o final da chave, para a tela mostrar sem expor o segredo (ex.: `…a1b2`). */
export function finalDaChave(chaveEmTexto: string | null): string | null {
  if (!chaveEmTexto) return null
  return `…${chaveEmTexto.slice(-4)}`
}
