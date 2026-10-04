import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

/**
 * Hash de senha com scrypt (nativo do Node, sem dependência extra).
 * Somente runtime Node — NÃO importar no `proxy.ts` (Edge).
 *
 * Formato armazenado: `scrypt$<salt hex>$<hash hex>`.
 */
const scrypt = promisify(scryptCb) as (senha: string, salt: Buffer, tamanho: number) => Promise<Buffer>

const TAMANHO_HASH = 64

export async function hashSenha(senha: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(senha, salt, TAMANHO_HASH)
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`
}

export async function verificarSenha(senha: string, armazenado: string): Promise<boolean> {
  const [algoritmo, saltHex, hashHex] = armazenado.split("$")
  if (algoritmo !== "scrypt" || !saltHex || !hashHex) return false
  const esperado = Buffer.from(hashHex, "hex")
  const obtido = await scrypt(senha, Buffer.from(saltHex, "hex"), esperado.length)
  return esperado.length === obtido.length && timingSafeEqual(esperado, obtido)
}
