/** Credenciais do `.env` — usadas somente para criar o primeiro admin. */
export function getConfiguredCredentials(): { username: string; password: string } | null {
  const username = process.env.AUTH_USERNAME ?? ""
  const password = process.env.AUTH_PASSWORD ?? ""
  return username.length > 0 && password.length > 0 ? { username, password } : null
}
