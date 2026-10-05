import { hashSenha, verificarSenha } from "@/lib/password"
import { getConfiguredCredentials } from "@/lib/auth-env"
import { SENHA_MIN } from "@/lib/senha"
import {
  isUserRole,
  normalizarPoderes,
  normalizarSecoes,
  ordemDoNivel,
  podeGerenciarNivel,
  secoesQuePodeConceder,
  temPoder,
  type PoderKey,
  type SecaoKey,
  type UserRole,
} from "@/lib/permissoes"
import { prisma, prismaGlobal } from "@/lib/prisma"
import { workspacePrincipalId } from "@/lib/workspace-context"
import { excluirWorkspace } from "@/services/workspaces"
import { TEMA_PADRAO, temaOuPadrao, type TemaApp } from "@/lib/temas"

export type Usuario = {
  id: string
  username: string
  nome: string
  role: UserRole
  secoes: SecaoKey[]
  poderes: PoderKey[]
  ativo: boolean
  temaApp: TemaApp
  chatIdentificarRemetente: boolean
  criadoEm: Date
  /** Instância (espaço de dados) do usuário. Admin tem a própria; padrão herda a de quem o criou. */
  workspaceId: string
}

/** Quem está executando a ação (o usuário logado). */
export type Ator = Pick<Usuario, "id" | "role" | "secoes" | "poderes" | "workspaceId">

/**
 * De onde vem a ação. Em "crm", o poder `crm_gerenciar` (checado na action) já
 * cobre criar/editar/excluir o login de atendentes; a hierarquia continua valendo.
 */
export type ContextoGestao = "usuarios" | "crm"

type UserRow = {
  id: string
  username: string
  nome: string
  role: UserRole
  secoes: string[]
  poderes: string[]
  ativo: boolean
  temaApp: string
  chatIdentificarRemetente: boolean
  criadoEm: Date
  workspaceId: string
}

export function toUsuario(row: UserRow): Usuario {
  return {
    id: row.id,
    username: row.username,
    nome: row.nome,
    role: row.role,
    secoes: normalizarSecoes(row.secoes),
    poderes: normalizarPoderes(row.poderes),
    ativo: row.ativo,
    temaApp: temaOuPadrao(row.temaApp),
    chatIdentificarRemetente: row.chatIdentificarRemetente,
    criadoEm: row.criadoEm,
    workspaceId: row.workspaceId,
  }
}

/** Erro de regra de negócio, exibido como está para quem fez a ação. */
export class UserError extends Error {}

const USERNAME = /^[a-z0-9._-]{3,32}$/

export function normalizarUsername(valor: string): string {
  return valor.trim().toLowerCase()
}

/**
 * Lista os usuários que o ator pode ver na gestão:
 *  - root: os usuários da instância principal + os admins (cada um com a própria
 *    instância — o root gerencia a conta do admin, nunca os dados dele);
 *  - admin: só os usuários padrão da instância dele.
 */
export async function listUsers(ator: Pick<Ator, "role" | "workspaceId">): Promise<Usuario[]> {
  const rows =
    ator.role === "root"
      ? await prismaGlobal.user.findMany({
          where: { OR: [{ workspaceId: ator.workspaceId }, { role: "admin" }] },
          orderBy: { nome: "asc" },
        })
      : await prisma.user.findMany({ where: { role: "padrao" }, orderBy: { nome: "asc" } })
  return rows
    .map(toUsuario)
    .sort((a, b) => ordemDoNivel(b.role) - ordemDoNivel(a.role) || a.nome.localeCompare(b.nome, "pt-BR"))
}

/** Usuário da instância atual (para outras instâncias, só pelas regras de gestão abaixo). */
export async function getUserById(id: string): Promise<Usuario | null> {
  const row = await prisma.user.findUnique({ where: { id } })
  return row ? toUsuario(row) : null
}

/**
 * Busca um usuário que o ator pode gerenciar: da própria instância, ou — só para
 * o root — um admin (que vive na instância dele). Qualquer outro caso é "não encontrado".
 */
async function buscarGerenciavel(id: string, ator: Pick<Ator, "role" | "workspaceId">) {
  const row = await prismaGlobal.user.findUnique({ where: { id } })
  if (!row) return null
  if (row.workspaceId === ator.workspaceId) return row
  if (ator.role === "root" && row.role === "admin") return row
  return null
}

async function contarRootsAtivos(excluirId?: string): Promise<number> {
  return prismaGlobal.user.count({
    where: { role: "root", ativo: true, ...(excluirId ? { id: { not: excluirId } } : {}) },
  })
}

export type UserInput = {
  username: string
  nome: string
  /** Obrigatória ao criar; ao editar, vazia = manter a senha atual. */
  senha?: string
  role: UserRole
  /** Seções liberadas (admin e padrão). Ignorado para root. */
  secoes: string[]
  /** Poderes do admin — só o root define. Omitido = manter os atuais. */
  poderes?: string[]
  ativo: boolean
}

function validar(input: UserInput, criando: boolean) {
  const username = normalizarUsername(input.username)
  const nome = input.nome.trim()
  if (!nome) throw new UserError("Informe o nome do usuário.")
  if (!USERNAME.test(username)) {
    throw new UserError("O login deve ter de 3 a 32 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.")
  }
  if (!isUserRole(input.role)) throw new UserError("Selecione um nível válido.")
  const senha = input.senha ?? ""
  if ((criando || senha.length > 0) && senha.length < SENHA_MIN) {
    throw new UserError(`A senha deve ter pelo menos ${SENHA_MIN} caracteres.`)
  }
  return { username, nome, senha }
}

/** Seções e poderes que um usuário NOVO recebe, respeitando o que o ator pode conceder. */
function acessoParaCriar(input: UserInput, ator: Ator, contexto: ContextoGestao) {
  if (input.role === "root") return { secoes: [] as SecaoKey[], poderes: [] as PoderKey[] }
  if (input.role === "admin") {
    // Só o root chega aqui (checado antes): define o que o admin acessa e controla.
    return { secoes: normalizarSecoes(input.secoes), poderes: normalizarPoderes(input.poderes) }
  }
  const podeDefinir = ator.role === "root" || contexto === "crm" || temPoder(ator, "usuarios_secoes")
  const concedivel = new Set<string>(secoesQuePodeConceder(ator))
  const secoes = podeDefinir ? normalizarSecoes(input.secoes).filter((s) => concedivel.has(s)) : []
  return { secoes, poderes: [] as PoderKey[] }
}

export async function createUser(input: UserInput, ator: Ator, contexto: ContextoGestao = "usuarios"): Promise<Usuario> {
  // Autoridade primeiro, validação do formulário depois.
  if (!podeGerenciarNivel(ator, input.role)) {
    throw new UserError(
      input.role === "padrao"
        ? "Você não tem permissão para criar usuários."
        : "Apenas o Root pode criar usuários desse nível.",
    )
  }
  if (contexto === "usuarios" && !temPoder(ator, "usuarios_criar")) {
    throw new UserError("Você não tem permissão para criar usuários.")
  }

  const { username, nome, senha } = validar(input, true)
  // O login é único no sistema todo (é por ele que se descobre a instância no acesso).
  const existente = await prismaGlobal.user.findUnique({ where: { username }, select: { id: true } })
  if (existente) throw new UserError("Já existe um usuário com esse login.")

  const { secoes, poderes } = acessoParaCriar(input, ator, contexto)
  const senhaHash = await hashSenha(senha)

  // Admin = instância nova e privada (só o root cria). Os demais entram na instância de quem os cria.
  if (input.role === "admin") {
    const row = await prismaGlobal.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({ data: { nome, ativo: input.ativo } })
      return tx.user.create({
        data: {
          workspaceId: workspace.id,
          username,
          nome,
          senhaHash,
          role: "admin",
          secoes,
          poderes,
          ativo: input.ativo,
          temaApp: TEMA_PADRAO,
        },
      })
    })
    return toUsuario(row)
  }

  const settings = await prisma.settings.findUnique({ where: { workspaceId: ator.workspaceId }, select: { temaApp: true } }).catch(() => null)
  const row = await prisma.user.create({
    data: {
      username,
      nome,
      senhaHash,
      role: input.role,
      secoes,
      poderes,
      ativo: input.ativo,
      temaApp: temaOuPadrao(settings?.temaApp ?? TEMA_PADRAO),
      workspaceId: ator.workspaceId, // o filtro de instância grava o mesmo valor
    },
  })
  return toUsuario(row)
}

export async function updateUser(
  id: string,
  input: UserInput,
  ator: Ator,
  contexto: ContextoGestao = "usuarios",
): Promise<Usuario> {
  const dados = validar(input, false)
  const atual = await buscarGerenciavel(id, ator)
  if (!atual) throw new UserError("Usuário não encontrado.")

  // Admin e as demais contas vivem em instâncias diferentes: trocar entre os dois lados
  // moveria (ou abandonaria) os dados. Para isso, crie um usuário novo.
  if (input.role !== atual.role && (atual.role === "admin" || input.role === "admin")) {
    throw new UserError("Não é possível converter um Administrador em outro nível (nem o contrário). Crie um novo usuário.")
  }

  // Hierarquia: ninguém mexe em quem está no mesmo nível ou acima (só o Root, em todos).
  // Cada um altera os próprios dados em "Minha conta"; o Root também pode, aqui,
  // trocar o próprio nome/login/senha — mas nunca o próprio nível, status ou acesso.
  const aSiMesmo = ator.id === id
  if (aSiMesmo) {
    if (ator.role !== "root") throw new UserError("Para alterar seus próprios dados, use Minha conta.")
  } else {
    if (!podeGerenciarNivel(ator, atual.role)) throw new UserError("Você não tem permissão para alterar este usuário.")
    if (!podeGerenciarNivel(ator, input.role)) throw new UserError("Você não tem permissão para definir esse nível.")
  }

  const podeEditarDados = contexto === "crm" || temPoder(ator, "usuarios_editar")
  if (!podeEditarDados && dados.senha.length > 0) {
    throw new UserError("Você não tem permissão para alterar a senha deste usuário.")
  }
  const username = podeEditarDados ? dados.username : atual.username
  const nome = podeEditarDados ? dados.nome : atual.nome
  const senha = podeEditarDados ? dados.senha : ""
  const role: UserRole = aSiMesmo ? atual.role : input.role
  const ativo = aSiMesmo || !podeEditarDados ? atual.ativo : input.ativo

  const duplicado = await prismaGlobal.user.findFirst({ where: { username, id: { not: id } }, select: { id: true } })
  if (duplicado) throw new UserError("Já existe um usuário com esse login.")

  // Nunca pode ficar sem nenhum Root ativo: rebaixar/desativar o último é barrado.
  const deixaDeSerRootAtivo = atual.role === "root" && atual.ativo && (role !== "root" || !ativo)
  if (deixaDeSerRootAtivo && (await contarRootsAtivos(id)) === 0) {
    throw new UserError("Deve existir ao menos um Root ativo. Promova outro usuário antes de alterar este.")
  }

  // Seções e poderes.
  let secoes: SecaoKey[]
  let poderes: PoderKey[]
  if (role === "root") {
    secoes = []
    poderes = []
  } else if (role === "admin") {
    // Só o Root chega aqui: decide o que o admin acessa e controla.
    secoes = normalizarSecoes(input.secoes)
    poderes = input.poderes === undefined ? normalizarPoderes(atual.poderes) : normalizarPoderes(input.poderes)
  } else {
    poderes = []
    const atuais = normalizarSecoes(atual.secoes)
    if (ator.role === "root") {
      secoes = normalizarSecoes(input.secoes)
    } else if (contexto === "usuarios" && temPoder(ator, "usuarios_secoes")) {
      // O admin só mexe nas seções que ele mesmo acessa; as demais ficam como estão.
      const concedivel = new Set<string>(secoesQuePodeConceder(ator))
      const mantidas = atuais.filter((s) => !concedivel.has(s))
      const novas = normalizarSecoes(input.secoes).filter((s) => concedivel.has(s))
      secoes = [...new Set([...mantidas, ...novas])]
    } else {
      secoes = atuais
    }
  }

  const row = await prismaGlobal.user.update({
    where: { id },
    data: {
      username,
      nome,
      role,
      secoes,
      poderes,
      ativo,
      ...(senha ? { senhaHash: await hashSenha(senha) } : {}),
    },
  })
  // Desativar um admin suspende a instância inteira (ele e os usuários dele); reativar libera de volta.
  if (role === "admin" && !aSiMesmo) {
    await prismaGlobal.workspace.update({ where: { id: row.workspaceId }, data: { ativo, nome } })
  }
  return toUsuario(row)
}

export async function deleteUser(id: string, ator: Ator, contexto: ContextoGestao = "usuarios"): Promise<void> {
  if (id === ator.id) throw new UserError("Você não pode excluir o próprio usuário.")
  const alvo = await buscarGerenciavel(id, ator)
  if (!alvo) throw new UserError("Usuário não encontrado.")
  if (!podeGerenciarNivel(ator, alvo.role)) throw new UserError("Você não tem permissão para excluir este usuário.")
  if (contexto === "usuarios" && !temPoder(ator, "usuarios_excluir")) {
    throw new UserError("Você não tem permissão para excluir usuários.")
  }
  if (alvo.role === "root" && alvo.ativo && (await contarRootsAtivos(id)) === 0) {
    throw new UserError("Deve existir ao menos um Root ativo.")
  }
  // Excluir um admin apaga a instância dele: todos os dados e todos os usuários dessa instância.
  if (alvo.role === "admin") {
    await excluirWorkspace(alvo.workspaceId)
    return
  }
  await prismaGlobal.user.delete({ where: { id } })
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
 * credenciais de `AUTH_USERNAME`/`AUTH_PASSWORD` criam o primeiro usuário, já como Root — assim
 * quem já usava o painel continua entrando com o mesmo login.
 */
export async function autenticar(usernameBruto: string, senha: string): Promise<Usuario | null> {
  const username = normalizarUsername(usernameBruto)

  const total = await prismaGlobal.user.count()
  if (total === 0) {
    const env = getConfiguredCredentials()
    if (!env) return null
    if (username !== normalizarUsername(env.username) || senha !== env.password) return null
    const workspaceId = await workspacePrincipalId()
    if (!workspaceId) return null
    const settings = await prismaGlobal.settings.findUnique({ where: { workspaceId }, select: { temaApp: true } }).catch(() => null)
    const criado = await prismaGlobal.user.create({
      data: {
        workspaceId,
        username,
        nome: "Root",
        senhaHash: await hashSenha(senha),
        role: "root",
        secoes: [],
        poderes: [],
        ativo: true,
        temaApp: temaOuPadrao(settings?.temaApp ?? TEMA_PADRAO),
      },
    })
    return toUsuario(criado)
  }

  const row = await prismaGlobal.user.findUnique({ where: { username } })
  // Compara mesmo sem usuário para não vazar, pelo tempo de resposta, que o login não existe.
  const ok = await verificarSenha(senha, row?.senhaHash ?? "scrypt$00$00")
  if (!row || !ok || !row.ativo) return null
  // Instância suspensa (admin desativado pelo Root): ninguém dela entra.
  const workspace = await prismaGlobal.workspace.findUnique({ where: { id: row.workspaceId }, select: { ativo: true } })
  if (!workspace?.ativo) return null
  return toUsuario(row)
}
