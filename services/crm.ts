import { prisma } from "@/lib/prisma"
import { normalizarSecoes, type SecaoKey, type UserRole } from "@/lib/permissoes"
import { createUser, deleteUser, updateUser } from "@/services/users"
import { emitWebhookEvent } from "@/services/webhooks"

/**
 * Plugin CRM — departamentos, atendentes e transferência de conversas do chat.
 *
 * Atendente não é um cadastro paralelo de pessoas: é um perfil em cima de um
 * `User` (admin ou padrão). Login, senha e nível continuam em `services/users.ts`;
 * aqui ficam só os dados de atendimento (departamentos e se recebe conversas).
 */

/** Erro de regra de negócio, exibido como está para o usuário. */
export class CrmError extends Error {}

// ---------------------------------------------------------------------------
// Tipos (serializáveis: trafegam do servidor para os componentes)
// ---------------------------------------------------------------------------

export type DepartamentoItem = {
  id: string
  nome: string
  descricao: string | null
  ativo: boolean
  totalAtendentes: number
  totalConversas: number
}

export type AtendenteItem = {
  id: string
  userId: string
  nome: string
  username: string
  role: UserRole
  /** Recebe conversas? Independe de o usuário conseguir entrar no painel. */
  ativo: boolean
  /** Login ativo em Usuários. Inativo = não entra no painel. */
  usuarioAtivo: boolean
  departamentoIds: string[]
  totalConversas: number
  /** Admin sempre acessa; usuário padrão precisa da seção Chat liberada para atender. */
  acessaChat: boolean
}

export type UsuarioDisponivel = { id: string; nome: string; username: string; role: UserRole }

export type CrmData = {
  departamentos: DepartamentoItem[]
  atendentes: AtendenteItem[]
  /** Usuários ativos que ainda não são atendentes (para vincular um existente). */
  usuariosDisponiveis: UsuarioDisponivel[]
}

/** Quem é o responsável por uma conversa do chat. */
export type ChatAtendimento = {
  departamentoId: string | null
  departamentoNome: string | null
  atendenteId: string | null
  atendenteNome: string | null
  transferidoEm: string
}

/** Opções do diálogo de transferência do chat. */
export type CrmChatOpcoes = {
  departamentos: { id: string; nome: string }[]
  atendentes: { id: string; nome: string; role: UserRole; departamentoIds: string[] }[]
  /** Atendente do usuário logado (para o filtro "Meus chats"), se ele tiver perfil. */
  meuAtendenteId: string | null
}

const LIMITE_NOME = 60
const LIMITE_DESCRICAO = 200
const LIMITE_MOTIVO = 500

function limparTexto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : ""
}

// ---------------------------------------------------------------------------
// Departamentos
// ---------------------------------------------------------------------------

export type DepartamentoInput = { nome: string; descricao?: string | null; ativo: boolean }

function validarDepartamento(input: DepartamentoInput) {
  const nome = limparTexto(input.nome)
  const descricao = limparTexto(input.descricao) || null
  if (nome.length < 2) throw new CrmError("Informe o nome do departamento (mínimo de 2 caracteres).")
  if (nome.length > LIMITE_NOME) throw new CrmError(`O nome pode ter no máximo ${LIMITE_NOME} caracteres.`)
  if (descricao && descricao.length > LIMITE_DESCRICAO) {
    throw new CrmError(`A descrição pode ter no máximo ${LIMITE_DESCRICAO} caracteres.`)
  }
  return { nome, descricao, ativo: Boolean(input.ativo) }
}

async function garantirNomeDepartamentoLivre(nome: string, ignorarId?: string) {
  const duplicado = await prisma.departamento.findFirst({
    where: { nome: { equals: nome, mode: "insensitive" }, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
    select: { id: true },
  })
  if (duplicado) throw new CrmError("Já existe um departamento com esse nome.")
}

export async function createDepartamento(input: DepartamentoInput): Promise<void> {
  const dados = validarDepartamento(input)
  await garantirNomeDepartamentoLivre(dados.nome)
  await prisma.departamento.create({ data: dados })
}

export async function updateDepartamento(id: string, input: DepartamentoInput): Promise<void> {
  const dados = validarDepartamento(input)
  const atual = await prisma.departamento.findUnique({ where: { id }, select: { id: true } })
  if (!atual) throw new CrmError("Departamento não encontrado.")
  await garantirNomeDepartamentoLivre(dados.nome, id)
  await prisma.departamento.update({ where: { id }, data: dados })
}

export async function setDepartamentoAtivo(id: string, ativo: boolean): Promise<void> {
  const atual = await prisma.departamento.findUnique({ where: { id }, select: { id: true } })
  if (!atual) throw new CrmError("Departamento não encontrado.")
  await prisma.departamento.update({ where: { id }, data: { ativo } })
}

/** Exclui o departamento. As conversas dele ficam sem departamento e os vínculos com atendentes somem. */
export async function deleteDepartamento(id: string): Promise<{ conversas: number }> {
  const atual = await prisma.departamento.findUnique({ where: { id }, select: { id: true } })
  if (!atual) throw new CrmError("Departamento não encontrado.")
  const conversas = await prisma.leadAtendimento.count({ where: { departamentoId: id } })
  await prisma.departamento.delete({ where: { id } })
  return { conversas }
}

// ---------------------------------------------------------------------------
// Atendentes
// ---------------------------------------------------------------------------

export type AtendenteInput = {
  /** Vincula um usuário que já existe. Se vazio, `nome`/`username`/`senha` criam um novo. */
  userId?: string | null
  nome: string
  username: string
  /** Obrigatória ao criar um usuário novo; ao editar, vazia = manter a atual. */
  senha?: string
  role: UserRole
  departamentoIds: string[]
  ativo: boolean
}

async function validarDepartamentoIds(valor: unknown): Promise<string[]> {
  const ids = [...new Set((Array.isArray(valor) ? valor : []).filter((v): v is string => typeof v === "string" && v.length > 0))]
  if (ids.length === 0) return []
  const existentes = await prisma.departamento.count({ where: { id: { in: ids } } })
  if (existentes !== ids.length) throw new CrmError("Algum departamento selecionado não existe mais. Atualize a página.")
  return ids
}

export async function createAtendente(input: AtendenteInput): Promise<void> {
  const departamentoIds = await validarDepartamentoIds(input.departamentoIds)
  const userIdExistente = limparTexto(input.userId)

  // Usuário existente: só cria o perfil de atendente em cima dele.
  if (userIdExistente) {
    const usuario = await prisma.user.findUnique({
      where: { id: userIdExistente },
      select: { id: true, ativo: true, atendente: { select: { id: true } } },
    })
    if (!usuario) throw new CrmError("Usuário não encontrado.")
    if (!usuario.ativo) throw new CrmError("Esse usuário está inativo. Ative-o em Usuários antes de torná-lo atendente.")
    if (usuario.atendente) throw new CrmError("Esse usuário já é atendente.")

    await prisma.atendente.create({
      data: {
        userId: usuario.id,
        ativo: Boolean(input.ativo),
        departamentos: { create: departamentoIds.map((departamentoId) => ({ departamentoId })) },
      },
    })
    return
  }

  // Usuário novo: reaproveita as validações e o hash de senha de `services/users.ts`.
  // Usuário padrão nasce com a seção Chat liberada, já que é lá que ele atende.
  const role: UserRole = input.role === "admin" ? "admin" : "padrao"
  const usuario = await createUser({
    username: input.username,
    nome: input.nome,
    senha: input.senha,
    role,
    secoes: role === "admin" ? [] : ["chat"],
    ativo: true,
  })

  try {
    await prisma.atendente.create({
      data: {
        userId: usuario.id,
        ativo: Boolean(input.ativo),
        departamentos: { create: departamentoIds.map((departamentoId) => ({ departamentoId })) },
      },
    })
  } catch (error) {
    // Não deixa um usuário órfão para trás se o perfil não pôde ser criado.
    await prisma.user.delete({ where: { id: usuario.id } }).catch(() => undefined)
    throw error
  }
}

export async function updateAtendente(id: string, input: AtendenteInput): Promise<void> {
  const departamentoIds = await validarDepartamentoIds(input.departamentoIds)
  const atual = await prisma.atendente.findUnique({
    where: { id },
    select: { id: true, userId: true, user: { select: { role: true, secoes: true, ativo: true } } },
  })
  if (!atual) throw new CrmError("Atendente não encontrado.")

  const role: UserRole = input.role === "admin" ? "admin" : "padrao"
  const secoesAtuais = normalizarSecoes(atual.user.secoes)
  // Rebaixado de admin para padrão sem nenhuma seção? Libera o Chat para ele continuar atendendo.
  const secoes: SecaoKey[] = role === "padrao" && atual.user.role === "admin" && secoesAtuais.length === 0 ? ["chat"] : secoesAtuais

  // Login, nome, senha e nível passam pelas mesmas regras de Usuários (inclusive
  // a de nunca ficar sem um admin ativo).
  await updateUser(atual.userId, {
    username: input.username,
    nome: input.nome,
    senha: input.senha,
    role,
    secoes,
    ativo: atual.user.ativo,
  })

  await prisma.$transaction([
    prisma.atendenteDepartamento.deleteMany({ where: { atendenteId: id } }),
    prisma.atendenteDepartamento.createMany({ data: departamentoIds.map((departamentoId) => ({ atendenteId: id, departamentoId })) }),
    prisma.atendente.update({ where: { id }, data: { ativo: Boolean(input.ativo) } }),
  ])
}

export async function setAtendenteAtivo(id: string, ativo: boolean): Promise<void> {
  const atual = await prisma.atendente.findUnique({ where: { id }, select: { id: true } })
  if (!atual) throw new CrmError("Atendente não encontrado.")
  await prisma.atendente.update({ where: { id }, data: { ativo } })
}

/**
 * Remove o perfil de atendente. As conversas dele ficam sem atendente (mantêm o
 * departamento). Com `excluirUsuario`, apaga também o login — respeitando as
 * regras de Usuários (não excluir a si mesmo nem o último admin ativo).
 */
export async function deleteAtendente(id: string, solicitanteId: string, excluirUsuario: boolean): Promise<void> {
  const atual = await prisma.atendente.findUnique({ where: { id }, select: { id: true, userId: true } })
  if (!atual) throw new CrmError("Atendente não encontrado.")

  if (excluirUsuario) {
    // O perfil sai junto (onDelete: Cascade em Atendente.userId).
    await deleteUser(atual.userId, solicitanteId)
    return
  }
  await prisma.atendente.delete({ where: { id } })
}

// ---------------------------------------------------------------------------
// Leitura para a página do CRM
// ---------------------------------------------------------------------------

export async function getCrmData(): Promise<CrmData> {
  const [departamentos, atendentes, conversasPorDepartamento, conversasPorAtendente, usuarios] = await Promise.all([
    prisma.departamento.findMany({
      orderBy: [{ ativo: "desc" }, { nome: "asc" }],
      select: { id: true, nome: true, descricao: true, ativo: true, _count: { select: { atendentes: true } } },
    }),
    prisma.atendente.findMany({
      orderBy: [{ ativo: "desc" }, { user: { nome: "asc" } }],
      select: {
        id: true,
        userId: true,
        ativo: true,
        user: { select: { nome: true, username: true, role: true, secoes: true, ativo: true } },
        departamentos: { select: { departamentoId: true } },
      },
    }),
    prisma.leadAtendimento.groupBy({ by: ["departamentoId"], _count: { _all: true } }),
    prisma.leadAtendimento.groupBy({ by: ["atendenteId"], _count: { _all: true } }),
    prisma.user.findMany({
      where: { ativo: true, atendente: null },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, username: true, role: true },
    }),
  ])

  const porDepartamento = new Map<string, number>()
  for (const linha of conversasPorDepartamento) {
    if (linha.departamentoId) porDepartamento.set(linha.departamentoId, linha._count._all)
  }
  const porAtendente = new Map<string, number>()
  for (const linha of conversasPorAtendente) {
    if (linha.atendenteId) porAtendente.set(linha.atendenteId, linha._count._all)
  }

  return {
    departamentos: departamentos.map((d) => ({
      id: d.id,
      nome: d.nome,
      descricao: d.descricao,
      ativo: d.ativo,
      totalAtendentes: d._count.atendentes,
      totalConversas: porDepartamento.get(d.id) ?? 0,
    })),
    atendentes: atendentes.map((a) => ({
      id: a.id,
      userId: a.userId,
      nome: a.user.nome,
      username: a.user.username,
      role: a.user.role,
      ativo: a.ativo,
      usuarioAtivo: a.user.ativo,
      departamentoIds: a.departamentos.map((v) => v.departamentoId),
      totalConversas: porAtendente.get(a.id) ?? 0,
      acessaChat: a.user.role === "admin" || normalizarSecoes(a.user.secoes).includes("chat"),
    })),
    usuariosDisponiveis: usuarios,
  }
}

// ---------------------------------------------------------------------------
// Integração com o chat
// ---------------------------------------------------------------------------

/** Departamentos e atendentes ATIVOS, que podem receber uma transferência. */
export async function getCrmChatOpcoes(usuarioId: string): Promise<CrmChatOpcoes> {
  const [departamentos, atendentes, meu] = await Promise.all([
    prisma.departamento.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    prisma.atendente.findMany({
      where: { ativo: true, user: { ativo: true } },
      orderBy: { user: { nome: "asc" } },
      select: {
        id: true,
        user: { select: { nome: true, role: true } },
        departamentos: { select: { departamentoId: true } },
      },
    }),
    prisma.atendente.findUnique({ where: { userId: usuarioId }, select: { id: true } }),
  ])

  return {
    departamentos,
    atendentes: atendentes.map((a) => ({
      id: a.id,
      nome: a.user.nome,
      role: a.user.role,
      departamentoIds: a.departamentos.map((v) => v.departamentoId),
    })),
    meuAtendenteId: meu?.id ?? null,
  }
}

/** Responsável atual de cada conversa que já foi transferida (leads sem linha = sem responsável). */
export async function listAtendimentosPorLead(): Promise<Map<string, ChatAtendimento>> {
  const linhas = await prisma.leadAtendimento.findMany({
    select: {
      leadId: true,
      departamentoId: true,
      atendenteId: true,
      transferidoEm: true,
      departamento: { select: { nome: true } },
      atendente: { select: { user: { select: { nome: true } } } },
    },
  })

  return new Map(
    linhas.map((linha) => [
      linha.leadId,
      {
        departamentoId: linha.departamentoId,
        departamentoNome: linha.departamento?.nome ?? null,
        atendenteId: linha.atendenteId,
        atendenteNome: linha.atendente?.user.nome ?? null,
        transferidoEm: linha.transferidoEm.toISOString(),
      },
    ]),
  )
}

export type TransferenciaInput = {
  departamentoId?: string | null
  atendenteId?: string | null
  motivo?: string | null
}

function rotuloResponsavel(departamento: string | null | undefined, atendente: string | null | undefined): string {
  const partes = [departamento, atendente].filter((parte): parte is string => Boolean(parte))
  return partes.length ? partes.join(" / ") : "Sem responsável"
}

/**
 * Transfere a conversa de um lead para um departamento e/ou atendente. Registra
 * o histórico e deixa uma nota interna na própria conversa, para a equipe ver o
 * que aconteceu sem sair do chat.
 */
export async function transferirConversa(
  leadId: string,
  input: TransferenciaInput,
  executor: { id: string; nome: string },
): Promise<{ para: string }> {
  const departamentoId = limparTexto(input.departamentoId) || null
  const atendenteId = limparTexto(input.atendenteId) || null
  const motivo = limparTexto(input.motivo) || null

  if (!departamentoId && !atendenteId) throw new CrmError("Selecione um departamento ou um atendente.")
  if (motivo && motivo.length > LIMITE_MOTIVO) throw new CrmError(`O motivo pode ter no máximo ${LIMITE_MOTIVO} caracteres.`)

  const [lead, atual, departamento, atendente] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, nome: true } }),
    prisma.leadAtendimento.findUnique({
      where: { leadId },
      select: {
        departamentoId: true,
        atendenteId: true,
        departamento: { select: { nome: true } },
        atendente: { select: { user: { select: { nome: true } } } },
      },
    }),
    departamentoId
      ? prisma.departamento.findUnique({ where: { id: departamentoId }, select: { id: true, nome: true, ativo: true } })
      : Promise.resolve(null),
    atendenteId
      ? prisma.atendente.findUnique({
          where: { id: atendenteId },
          select: {
            id: true,
            ativo: true,
            user: { select: { nome: true, ativo: true } },
            departamentos: { select: { departamentoId: true } },
          },
        })
      : Promise.resolve(null),
  ])

  if (!lead) throw new CrmError("Lead não encontrado.")
  if (departamentoId) {
    if (!departamento) throw new CrmError("Departamento não encontrado.")
    if (!departamento.ativo) throw new CrmError("O departamento selecionado está inativo.")
  }
  if (atendenteId) {
    if (!atendente) throw new CrmError("Atendente não encontrado.")
    if (!atendente.ativo || !atendente.user.ativo) throw new CrmError("O atendente selecionado está inativo.")
    if (departamentoId && !atendente.departamentos.some((v) => v.departamentoId === departamentoId)) {
      throw new CrmError("O atendente selecionado não pertence a esse departamento.")
    }
  }

  if ((atual?.departamentoId ?? null) === departamentoId && (atual?.atendenteId ?? null) === atendenteId) {
    throw new CrmError("A conversa já está com esse departamento e atendente.")
  }

  const de = rotuloResponsavel(atual?.departamento?.nome, atual?.atendente?.user.nome)
  const para = rotuloResponsavel(departamento?.nome, atendente?.user.nome)
  const nota = `Conversa transferida por ${executor.nome}: ${de} → ${para}.${motivo ? ` Motivo: ${motivo}` : ""}`

  await prisma.$transaction([
    prisma.leadAtendimento.upsert({
      where: { leadId },
      create: { leadId, departamentoId, atendenteId },
      update: { departamentoId, atendenteId, transferidoEm: new Date() },
    }),
    prisma.atendimentoTransferencia.create({
      data: {
        leadId,
        deDepartamento: atual?.departamento?.nome ?? null,
        paraDepartamento: departamento?.nome ?? null,
        deAtendente: atual?.atendente?.user.nome ?? null,
        paraAtendente: atendente?.user.nome ?? null,
        porUsuario: executor.nome,
        motivo,
      },
    }),
    // A nota aparece na conversa do chat como "Nota interna".
    prisma.chatInternalNote.create({ data: { leadId, texto: nota } }),
  ])

  void emitWebhookEvent("atendimento.transferido", {
    leadId,
    leadNome: lead.nome,
    de: { departamento: atual?.departamento?.nome ?? null, atendente: atual?.atendente?.user.nome ?? null },
    para: { departamento: departamento?.nome ?? null, atendente: atendente?.user.nome ?? null },
    porUsuario: executor.nome,
    motivo,
  })

  return { para }
}
