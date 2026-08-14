/**
 * Autenticação das rotas de API por token estático.
 *
 * Além da sessão por cookie (usada pelo painel no navegador), as rotas de
 * `/api/*` aceitam um token fixo definido em `API_TOKEN` no `.env`. Isso
 * permite chamar a API a partir de scripts, `curl` ou do painel de testes sem
 * depender de um cookie de sessão.
 *
 * O token pode ser enviado de duas formas equivalentes:
 *   - `Authorization: Bearer <API_TOKEN>`
 *   - `x-api-token: <API_TOKEN>`
 *
 * Usa apenas Web Crypto / APIs padrão para funcionar tanto no runtime Node
 * quanto no Edge (o `proxy.ts` importa daqui).
 */

export const API_TOKEN_HEADER = "x-api-token"

/** Retorna o token configurado no ambiente (vazio quando não definido). */
export function getConfiguredApiToken(): string {
  return process.env.API_TOKEN ?? ""
}

/** Indica se o token de API foi configurado no `.env`. */
export function isApiTokenConfigured(): boolean {
  return getConfiguredApiToken().length > 0
}

/** Comparação em tempo constante para evitar ataques de timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Extrai o token enviado na requisição (Bearer ou header dedicado). */
export function extractApiToken(headers: Headers): string | null {
  const auth = headers.get("authorization")
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim()
  }
  const dedicado = headers.get(API_TOKEN_HEADER)
  return dedicado ? dedicado.trim() : null
}

/** Valida um token recebido contra o `API_TOKEN` configurado. */
export function isValidApiToken(token: string | null | undefined): boolean {
  const esperado = getConfiguredApiToken()
  if (!esperado || !token) return false
  return timingSafeEqual(token, esperado)
}

/** Conveniência: valida diretamente os headers de uma requisição. */
export function requestHasValidApiToken(headers: Headers): boolean {
  return isValidApiToken(extractApiToken(headers))
}
