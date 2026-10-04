"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"

import { isTemaApp } from "@/lib/temas"
import { TEMA_COOKIE } from "@/lib/temas"
import { assertGestaoUsuarios, assertSecao, assertUsuario, ForbiddenError } from "@/lib/session"
import { recordAppLog } from "@/services/app-logs"
import {
  createUser,
  deleteUser,
  setUserChatIdentificar,
  setUserNome,
  setUserTema,
  trocarSenha,
  updateUser,
  UserError,
  type UserInput,
} from "@/services/users"

export type UserActionResult = { ok: boolean; message: string }

function falha(error: unknown, contexto: string): UserActionResult {
  if (error instanceof UserError || error instanceof ForbiddenError) return { ok: false, message: error.message }
  void recordAppLog({ origem: "usuarios", mensagem: contexto, detalhes: error })
  return { ok: false, message: contexto }
}

// ---------------------------------------------------------------------------
// Gestão de usuários — root e admins com poder de usuários (a hierarquia é checada no serviço)
// ---------------------------------------------------------------------------

export async function createUserAction(input: UserInput): Promise<UserActionResult> {
  try {
    const ator = await assertGestaoUsuarios()
    await createUser(input, ator)
  } catch (error) {
    return falha(error, "Não foi possível criar o usuário.")
  }
  revalidatePath("/usuarios")
  return { ok: true, message: "Usuário criado." }
}

export async function updateUserAction(id: string, input: UserInput): Promise<UserActionResult> {
  try {
    const ator = await assertGestaoUsuarios()
    await updateUser(id, input, ator)
  } catch (error) {
    return falha(error, "Não foi possível salvar o usuário.")
  }
  revalidatePath("/usuarios")
  revalidatePath("/", "layout")
  return { ok: true, message: "Usuário atualizado." }
}

export async function deleteUserAction(id: string): Promise<UserActionResult> {
  try {
    const ator = await assertGestaoUsuarios()
    await deleteUser(id, ator)
  } catch (error) {
    return falha(error, "Não foi possível excluir o usuário.")
  }
  revalidatePath("/usuarios")
  return { ok: true, message: "Usuário excluído." }
}

// ---------------------------------------------------------------------------
// Conta própria — qualquer usuário logado, sempre só sobre si mesmo
// ---------------------------------------------------------------------------

/** O tema é pessoal: grava no próprio usuário e não afeta ninguém mais. */
export async function saveMeuTemaAction(tema: string): Promise<UserActionResult> {
  try {
    const usuario = await assertUsuario()
    if (!isTemaApp(tema)) return { ok: false, message: "Selecione um dos temas disponíveis." }
    await setUserTema(usuario.id, tema)
    const store = await cookies()
    store.set(TEMA_COOKIE, tema, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" })
  } catch (error) {
    return falha(error, "Não foi possível salvar o tema.")
  }
  revalidatePath("/", "layout")
  return { ok: true, message: "Tema salvo só para você." }
}

/** Chat: liga/desliga o nome do remetente nas mensagens. Vale só para o próprio usuário. */
export async function saveChatIdentificarAction(ativo: boolean): Promise<UserActionResult> {
  try {
    const usuario = await assertSecao("chat")
    if (typeof ativo !== "boolean") return { ok: false, message: "Valor inválido." }
    await setUserChatIdentificar(usuario.id, ativo)
  } catch (error) {
    return falha(error, "Não foi possível salvar a preferência.")
  }
  return { ok: true, message: ativo ? "Seu nome será enviado junto com as mensagens." : "Suas mensagens serão enviadas sem identificação." }
}

export async function saveMeuNomeAction(nome: string): Promise<UserActionResult> {
  try {
    const usuario = await assertUsuario()
    const limpo = String(nome ?? "").trim()
    if (!limpo) return { ok: false, message: "Informe seu nome." }
    if (limpo.length > 80) return { ok: false, message: "O nome pode ter no máximo 80 caracteres." }
    await setUserNome(usuario.id, limpo)
  } catch (error) {
    return falha(error, "Não foi possível salvar o nome.")
  }
  revalidatePath("/", "layout")
  return { ok: true, message: "Nome atualizado." }
}

export async function alterarMinhaSenhaAction(senhaAtual: string, novaSenha: string): Promise<UserActionResult> {
  try {
    const usuario = await assertUsuario()
    await trocarSenha(usuario.id, String(senhaAtual ?? ""), String(novaSenha ?? ""))
  } catch (error) {
    return falha(error, "Não foi possível alterar a senha.")
  }
  return { ok: true, message: "Senha alterada." }
}
