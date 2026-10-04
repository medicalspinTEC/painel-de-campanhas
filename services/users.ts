import { hashSenha, verificarSenha } from "@/lib/password"
import { getConfiguredCredentials } from "@/lib/auth-env"
import { SENHA_MIN } from "@/lib/senha"
import { normalizarSecoes, type SecaoKey, type UserRole } from "@/lib/permissoes"
import { prisma } from "@/lib/prisma"
import { TEMA_PADRAO, temaOuPadrao, type TemaApp } from "@/lib/temas"

export type Usuario = {
  id: string
  username: string
  nome: string
  role: UserRole
  secoes: SecaoKey[]
  ativo: boolean
  temaApp: TemaApp
  chatIdentificarRemetente: boolean
  criadoEm: Date
}

type UserRow = {
  id: string
  username: string
  nome: string
  role: UserRole
  secoes: string[]
  ativo: boolean
  temaApp: string
  chatIdentificarRemetente: boolean
  criadoEm: Date
}

export function toUsuario(row: UserRow): Usuario {
  return {
    id: row.id,
    username: row.username,
    nome: row.nome,
    role: row.role,
    secoes: normalizarSecoes(row.secoes),
    ativo: row.ativo,
    temaApp: temaOuPadrao(row.temaApp),
    chatIdentificarRemetente: row.chatIdentificarRemetente,
    criadoEm: row.criadoEm,
  }
}

/** Erro de regra de negócio, exibido como está para o admin. */
export class UserError extends Error {}

const USERNAME = /^[a-z0-9._-]{3,32}$/

export function normalizarUsername(valor: string): string {
  return valor.trim().toLowerCase()
}

export async function listUsers(): Promise<Usuario[]> {
  const rows = await prisma.user.findMany({ orderBy: [{ role: "asc" }, { nome: "asc" }] })
  return rows.map(toUsuario)
}

export async function getUserById(id: string): Promise<Usuario | null> {
  const row = await prisma.user.findUnique({ where: { id } })
  return row ? toUsuario(row) : null
}

async function contarAdminsAtivos(excluirId?: string): Promise<number> {
  return prisma.user.count({
    where: { role: "admin", ativo: true, ...(excluirId ? { id: { not: excluirId } } : {}) },
  })
}

export type UserInput = {
  username: string
  nome: string
  /** Obrigatória ao criar; ao editar, vazia = manter a senha atual. */
  senha?: string
  role: UserRole
  secoes: string[]
  ativo: boolean
}

function validar(input: UserInput, criando: boolean) {
  const username = normalizarUsername(input.username)
  const nome = input.nome.trim()
  if (!nome) throw new UserError("Informe o nome do usuário.")
  if (!USERNAME.test(username)) {
    throw new UserError("O login deve ter de 3 a 32 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.")
  }
  if (input.role !== "admin" && input.role !== "padrao") throw new UserError("Selecione um nível válido.")
  const senha = input.senha ?? ""
  if ((criando || senha.length > 0) && senha.length < SENHA_MIN) {
    throw new UserError(`A senha deve ter pelo menos ${SENHA_MIN} caracteres.`)
  }
  return { username, nome, senha }
}

export async function createUser(input: UserInput): Promise<Usuario> {
  const { username, nome, senha } = validar(input, true)
  const existente = await prisma.user.findUnique({ where: { username }, select: { id: true } })
  if (existente) throw new UserError("Já existe um usuário com esse login.")

  const settings = await prisma.settings.findUnique({ where: { id: "default" }, select: { temaApp: true } }).catch(() => null)

  const row = await prisma.user.create({
    data: {
      username,
      nome,
      senhaHash: await hashSenha(senha),
      role: input.role,
      secoes: input.role === "admin" ? [] : normalizarSecoes(input.secoes),
      ativo: input.ativo,
      temaApp: temaOuPadrao(settings?.temaApp ?? TEMA_PADRAO),
    },
  })
  return toUsuario(row)
}

export async function updateUser(id: string, input: UserInput): Promise<Usuario> {
  const { username, nome, senha } = validar(input, false)
  const atual = await prisma.user.findUnique({ where: { id } })
  if (!atual) throw new UserError("Usuário não encontrado.")

  const duplicado = await prisma.user.findFirst({ where: { username, id: { not: id } }, select: { id: true } })
  if (duplicado) throw new UserError("Já existe um usuário com esse login.")

  // Nunca pode ficar sem nenhum admin ativo: rebaixar/desativar o último é barrado.
  const deixaDeSerAdminAtivo = atual.role === "admin" && atual.ativo && (input.role !== "admin" || !input.ativo)
  if (deixaDeSerAdminAtivo && (await contarAdminsAtivos(id)) === 0) {
    throw new UserError("Deve existir ao menos um admin ativo. Promova outro usuário antes de alterar este.")
  }

  const row = await prisma.user.update({
    where: { id },
    data: {
      username,
      nome,
      role: input.role,
      secoes: input.role === "admin" ? [] : normalizarSecoes(input.secoes),
      ativo: input.ativo,
      ...(senha ? { senhaHash: await hashSenha(senha) } : {}),
    },
  })
  return toUsuario(row)
}

export async function deleteUser(id: string, solicitanteId: string): Promise<void> {
  if (id === solicitanteId) throw new UserError("Você não pode excluir o próprio usuário.")
  const alvo = await prisma.user.findUnique({ where: { id } })
  if (!alvo) throw new UserError("Usuário não encontrado.")
  if (alvo.role === "admin" && alvo.ativo && (await contarAdminsAtivos(id)) === 0) {
    throw new UserError("Deve existir ao menos um admin ativo.")
  }
  await prisma.user.delete({ where: { id } })
}

/** Preferência pessoal: altera só o tema do próprio usuário. */
export async function setUserTema(id: string, tema: TemaApp): Promise<void> {
  await prisma.user.update({ where: { id }, data: { temaApp: tema } })
}

/** Preferência pessoal: liga/desliga o nome do remetente nas mensagens do chat. */
export async function setUserChatIdentificar(id: string, ativo: boolean): Promise<void> {
  await prisma.user.update({ where: { id }, data: { chatIdentificarRemetente: ativo } })
}

export async function setUserNome(id: string, nome: string): Promise<void> {
  await prisma.user.update({ where: { id }, data: { nome } })
}

export async function trocarSenha(id: string, senhaAtual: string, novaSenha: string): Promise<void> {
  if (novaSenha.length < SENHA_MIN) throw new UserError(`A nova senha deve ter pelo menos ${SENHA_MIN} caracteres.`)
  const row = await prisma.user.findUnique({ where: { id }, select: { senhaHash: true } })
  if (!row || !(await verificarSenha(senhaAtual, row.senhaHash))) throw new UserError("A senha atual está incorreta.")
  await prisma.user.update({ where: { id }, data: { senhaHash: await hashSenha(novaSenha) } })
}

/**
 * Valida login e senha. No primeiro acesso (nenhum usuário cadastrado), as
 * credenciais de `AUTH_USERNAME`/`AUTH_PASSWORD` criam o primeiro admin — assim
 * quem já usava o painel continua entrando com o mesmo login.
 */
export async function autenticar(usernameBruto: string, senha: string): Promise<Usuario | null> {
  const username = normalizarUsername(usernameBruto)

  const total = await prisma.user.count()
  if (total === 0) {
    const env = getConfiguredCredentials()
    if (!env) return null
    if (username !== normalizarUsername(env.username) || senha !== env.password) return null
    const settings = await prisma.settings.findUnique({ where: { id: "default" }, select: { temaApp: true } }).catch(() => null)
    const criado = await prisma.user.create({
      data: {
        username,
        nome: "Administrador",
        senhaHash: await hashSenha(senha),
        role: "admin",
        secoes: [],
        ativo: true,
        temaApp: temaOuPadrao(settings?.temaApp ?? TEMA_PADRAO),
      },
    })
    return toUsuario(criado)
  }

  const row = await prisma.user.findUnique({ where: { username } })
  // Compara mesmo sem usuário para não vazar, pelo tempo de resposta, que o login não existe.
  const ok = await verificarSenha(senha, row?.senhaHash ?? "scrypt$00$00")
  if (!row || !ok || !row.ativo) return null
  return toUsuario(row)
}
