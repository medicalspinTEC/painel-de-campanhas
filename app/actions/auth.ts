"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth"
import { getConfiguredCredentials } from "@/lib/auth-env"
import { prisma } from "@/lib/prisma"
import { TEMA_COOKIE } from "@/lib/temas"
import { autenticar } from "@/services/users"

export interface LoginState {
  error?: string
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim()
  const password = String(formData.get("password") ?? "")

  if (!username || !password) {
    return { error: "Informe usuário e senha." }
  }

  // Sem nenhum usuário cadastrado e sem credenciais no .env não há como criar o 1º admin.
  const semUsuarios = (await prisma.user.count()) === 0
  if (semUsuarios && !getConfiguredCredentials()) {
    return {
      error:
        "Nenhum usuário cadastrado. Defina AUTH_USERNAME e AUTH_PASSWORD nas variáveis de ambiente para criar o primeiro administrador.",
    }
  }

  const usuario = await autenticar(username, password)
  if (!usuario) {
    return { error: "Usuário ou senha inválidos." }
  }

  const store = await cookies()
  store.set(SESSION_COOKIE, await createSessionToken(usuario.id), sessionCookieOptions())
  // O tema é pessoal: o navegador passa a exibir o tema deste usuário.
  store.set(TEMA_COOKIE, usuario.temaApp, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" })

  redirect("/dashboard")
}

export async function logoutAction() {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
  redirect("/login")
}
