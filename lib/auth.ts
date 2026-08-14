/**
 * Autenticação simples de usuário único baseada em variáveis de ambiente.
 *
 * As credenciais ficam no `.env` (`AUTH_USERNAME` e `AUTH_PASSWORD`). Não há
 * banco de usuários — este painel é operado por uma equipe pequena, então um
 * único login compartilhado é suficiente.
 *
 * A sessão é um cookie assinado com HMAC-SHA256 (sem estado no servidor). Todo
 * o código aqui usa apenas Web Crypto (`crypto.subtle`) e APIs padrão, para
 * funcionar tanto no runtime Node (Server Actions) quanto no Edge (proxy.ts).
 */

export const SESSION_COOKIE = "campanhas_session"

// Duração da sessão: 7 dias.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

interface SessionPayload {
  /** Usuário autenticado. */
  u: string
  /** Timestamp (segundos) de expiração. */
  exp: number
}

/** Segredo usado para assinar o cookie. Cai no password quando não definido. */
function getSecret(): string {
  return process.env.AUTH_SECRET || process.env.AUTH_PASSWORD || "campanhas-dev-secret"
}

function getConfiguredUsername(): string {
  return process.env.AUTH_USERNAME ?? ""
}

function getConfiguredPassword(): string {
  return process.env.AUTH_PASSWORD ?? ""
}

/** Indica se as credenciais de login foram configuradas no ambiente. */
export function isAuthConfigured(): boolean {
  return getConfiguredUsername().length > 0 && getConfiguredPassword().length > 0
}

// ---- Helpers base64url (compatíveis com Edge e Node) ----

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function stringToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value))
}

function base64UrlToString(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// ---- Assinatura HMAC ----

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))
  return bytesToBase64Url(new Uint8Array(signature))
}

/** Comparação em tempo constante para evitar ataques de timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Confere usuário e senha contra as variáveis de ambiente. */
export function verifyCredentials(username: string, password: string): boolean {
  if (!isAuthConfigured()) return false
  const okUser = timingSafeEqual(username, getConfiguredUsername())
  const okPass = timingSafeEqual(password, getConfiguredPassword())
  return okUser && okPass
}

/** Cria um token de sessão assinado para o usuário informado. */
export async function createSessionToken(username: string): Promise<string> {
  const payload: SessionPayload = {
    u: username,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  }
  const data = stringToBase64Url(JSON.stringify(payload))
  const signature = await hmac(data)
  return `${data}.${signature}`
}

/** Valida um token de sessão. Retorna o usuário ou `null` se inválido/expirado. */
export async function verifySessionToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null
  const [data, signature] = token.split(".")
  if (!data || !signature) return null

  const expected = await hmac(data)
  if (!timingSafeEqual(signature, expected)) return null

  try {
    const payload = JSON.parse(base64UrlToString(data)) as SessionPayload
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }
    return payload.u
  } catch {
    return null
  }
}

/** Opções do cookie de sessão. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  }
}
