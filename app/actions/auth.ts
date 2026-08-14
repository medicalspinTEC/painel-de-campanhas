"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import {
  createSessionToken,
  isAuthConfigured,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifyCredentials,
} from "@/lib/auth"

export interface LoginState {
  error?: string
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!isAuthConfigured()) {
    return {
      error:
        "Login não configurado. Defina AUTH_USERNAME e AUTH_PASSWORD nas variáveis de ambiente do projeto.",
    }
  }

  const username = String(formData.get("username") ?? "").trim()
  const password = String(formData.get("password") ?? "")

  if (!username || !password) {
    return { error: "Informe usuário e senha." }
  }

  if (!verifyCredentials(username, password)) {
    return { error: "Usuário ou senha inválidos." }
  }

  const token = await createSessionToken(username)
  const store = await cookies()
  store.set(SESSION_COOKIE, token, sessionCookieOptions())

  redirect("/dashboard")
}

export async function logoutAction() {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
  redirect("/login")
}
