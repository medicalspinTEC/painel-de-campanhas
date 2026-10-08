import { prisma } from "@/lib/prisma"
import { normalizarSecoes, podeAcessar, podeGerenciarNivel, type SecaoKey, type UserRole } from "@/lib/permissoes"
import { avaliarAtendimento, type ContextoAtendimento } from "@/lib/crm-permissoes"
import { createUser, deleteUser, updateUser, type Ator } from "@/services/users"
import { pausarBot, reativarBot } from "@/services/bot-estado"
import { listCampanhasAbertas, type CampanhaAberta } from "@/services/campaigns"
import { exigirPlugin, getAgentesIaPluginAtivo, getCrmPluginAtivo } from "@/services/settings"
import { emitWebhookEvent } from "@/services/webhooks"

/**
 * Plugin CRM — departamentos, atendentes e transferência de conversas do chat.
 *
 * Atendente não é um cadastro paralelo de pessoas: é um perfil em cima de um
 * `User` (root, admin ou padrão). Login, senha e nível continuam em `services/users.ts`;
 * aqui ficam só os dados de atendimento (departamentos e se recebe conversas).
 */

/** Erro de regra de negócio, exibido como está para o usuário. */
export class CrmError extends Error {}

// ---------------------------------------------------------------------------
// Tipos (serializáveis: trafegam do servidor para os componentes)
// ---------------------------------------------------------------------------

/** Bot (fluxo No Code do tipo "bot") exibido na página do CRM. */
export type BotItem = {
  id: string
  nome: string
  ativo: boolean
  /** Total de blocos do fluxo (0 = ainda vazio). */
  totalBlocos: number
}

export type DepartamentoItem = {
  id: string
  nome: string
  descricao: string | null
  ativo: boolean
  totalAtendentes: number
  totalConversas: number
  /** Bots que atendem as conversas deste departamento enquanto não houver humano. */
  bots: BotItem[]
  /** Plugin Agentes de IA: agente que responde as conversas deste departamento (nulo = nenhum). */
  agenteIaId: string | null
}

/** Agente de IA que pode ser vinculado a um departamento ou à entrada (aba CRM). */
export type AgenteIaOpcao = { id: string; nome: string; ativo: boolean }

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
  /** Root sempre acessa; admin e usuário padrão precisam da seção Chat liberada para atender. */
  acessaChat: boolean
}

export type UsuarioDisponivel = { id: string; nome: string; username: string; role: UserRole }

export type CrmData = {
  /** Bots de entrada (triagem): atendem quem ainda não está em nenhum departamento. */
  botsEntrada: BotItem[]
  departamentos: DepartamentoItem[]
  atendentes: AtendenteItem[]
  /** Usuários ativos que ainda não são atendentes (para vincular um existente). */
  usuariosDisponiveis: UsuarioDisponivel[]
  /** Plugin Agentes de IA ativo: mostra os seletores de agente. */
  agentesIaAtivo: boolean
  agentesIa: AgenteIaOpcao[]
  /** Agente de IA de entrada (nulo = nenhum). */
  agenteIaEntradaId: string | null
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
  /** Contexto de permissão do usuário logado (mesmas regras aplicadas no servidor). */
  contexto: ContextoAtendimento
  /** Campanhas não encerradas, para "Enviar para campanha" no chat. */
  campanhas: CampanhaAberta[]
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
  await exigirPlugin("crm")
  const dados = validarDepartamento(input)
  await garantirNomeDepartamentoLivre(dados.nome)
  await prisma.departamento.create({ data: dados })
}

export async function updateDepartamento(id: string, input: DepartamentoInput): Promise<void> {
  await exigirPlugin("crm")
  const dados = validarDepartamento(input)
  const atual = await prisma.departamento.findUnique({ where: { id }, select: { id: true } })
  if (!atual) throw new CrmError("Departamento não encontrado.")
  await garantirNomeDepartamentoLivre(dados.nome, id)
  await prisma.departamento.update({ where: { id }, data: dados })
}

export async function setDepartamentoAtivo(id: string, ativo: boolean): Promise<void> {
  await exigirPlugin("crm")
  const atual = await prisma.departamento.findUnique({ where: { id }, select: { id: true } })
  if (!atual) throw new CrmError("Departamento não encontrado.")
  await prisma.departamento.update({ where: { id }, data: { ativo } })
}

/** Exclui o departamento. As conversas dele ficam sem departamento e os vínculos com atendentes somem. */
export async function deleteDepartamento(id: string): Promise<{ conversas: number }> {
  await exigirPlugin("crm")
  const atual = await prisma.departamento.findUnique({ where: { id }, select: { id: true } })
  if (!atual) throw new CrmError("Departamento não encontrado.")
  const conversas = await prisma.leadAtendimento.count({ where: { departamentoId: id } })
  // Os bots do departamento ficam órfãos (o vínculo vira nulo): desativa antes, para nunca
  // passarem a atender como se fossem o bot de entrada.
  await prisma.noCodeFlow.updateMany({ where: { departamentoId: id }, data: { ativo: false } })
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

export async function createAtendente(input: AtendenteInput, ator: Ator): Promise<void> {
  await exigirPlugin("crm")
  const departamentoIds = await validarDepartamentoIds(input.departamentoIds)
  const userIdExistente = limparTexto(input.userId)

  // Usuário existente: só cria o perfil de atendente em cima dele.
  if (userIdExistente) {
    const usuario = await prisma.user.findUnique({
      where: { id: userIdExistente },
      select: { id: true, ativo: true, role: true, atendente: { select: { id: true } } },
    })
    if (!usuario) throw new CrmError("Usuário não encontrado.")
    if (usuario.id !== ator.id && !podeGerenciarNivel(ator, usuario.role)) {
      throw new CrmError("Você não tem permissão para tornar esse usuário atendente.")
    }
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
  // Aqui só nasce usuário padrão: um admin tem instância própria (dados separados) e é criado
  // pelo Root em Usuários, então não faria sentido virar atendente desta instância.
  const role: UserRole = "padrao"
  const usuario = await createUser(
    {
      username: input.username,
      nome: input.nome,
      senha: input.senha,
      role,
      secoes: ["chat"],
      poderes: [],
      ativo: true,
    },
    ator,
    "crm",
  )

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

export async function updateAtendente(id: string, input: AtendenteInput, ator: Ator): Promise<void> {
  await exigirPlugin("crm")
  const departamentoIds = await validarDepartamentoIds(input.departamentoIds)
  const atual = await prisma.atendente.findUnique({
    where: { id },
    select: { id: true, userId: true, user: { select: { role: true, secoes: true, poderes: true, ativo: true } } },
  })
  if (!atual) throw new CrmError("Atendente não encontrado.")

  // Root nunca é rebaixado por aqui (o formulário só oferece admin/padrão).
  // Root e admin mantêm o nível (admin tem instância própria; trocar de nível não é permitido).
  const role: UserRole = atual.user.role === "root" || atual.user.role === "admin" ? atual.user.role : "padrao"
  const secoesAtuais = normalizarSecoes(atual.user.secoes)
  // Rebaixado de admin para padrão sem nenhuma seção? Libera o Chat para ele continuar atendendo.
  const secoes: SecaoKey[] = role === "padrao" && atual.user.role === "admin" && secoesAtuais.length === 0 ? ["chat"] : secoesAtuais

  // Login, nome, senha e nível passam pelas mesmas regras de Usuários (inclusive
  // a de nunca ficar sem um admin ativo).
  await updateUser(
    atual.userId,
    {
      username: input.username,
      nome: input.nome,
      senha: input.senha,
      role,
      secoes,
      poderes: atual.user.poderes,
      ativo: atual.user.ativo,
    },
    ator,
    "crm",
  )

  await prisma.$transaction([
    prisma.atendenteDepartamento.deleteMany({ where: { atendenteId: id } }),
    prisma.atendenteDepartamento.createMany({ data: departamentoIds.map((departamentoId) => ({ atendenteId: id, departamentoId })) }),
    prisma.atendente.update({ where: { id }, data: { ativo: Boolean(input.ativo) } }),
  ])
}

export async function setAtendenteAtivo(id: string, ativo: boolean): Promise<void> {
  await exigirPlugin("crm")
  const atual = await prisma.atendente.findUnique({ where: { id }, select: { id: true } })
  if (!atual) throw new CrmError("Atendente não encontrado.")
  await prisma.atendente.update({ where: { id }, data: { ativo } })
}

/**
 * Remove o perfil de atendente. As conversas dele ficam sem atendente (mantêm o
 * departamento). Com `excluirUsuario`, apaga também o login — respeitando as
 * regras de Usuários (não excluir a si mesmo nem o último admin ativo).
 */
export async function deleteAtendente(id: string, ator: Ator, excluirUsuario: boolean): Promise<void> {
  await exigirPlugin("crm")
  const atual = await prisma.atendente.findUnique({ where: { id }, select: { id: true, userId: true } })
  if (!atual) throw new CrmError("Atendente não encontrado.")

  if (excluirUsuario) {
    // O perfil sai junto (onDelete: Cascade em Atendente.userId).
    await deleteUser(atual.userId, ator, "crm")
    return
  }
  await prisma.atendente.delete({ where: { id } })
}

// ---------------------------------------------------------------------------
// Leitura para a página do CRM
// ---------------------------------------------------------------------------

export async function getCrmData(ator: Pick<Ator, "id" | "role">): Promise<CrmData> {
  const agentesIaAtivo = await getAgentesIaPluginAtivo()
  const [departamentos, atendentes, conversasPorDepartamento, conversasPorAtendente, usuarios, bots, agentesIa] = await Promise.all([
    prisma.departamento.findMany({
      orderBy: [{ ativo: "desc" }, { nome: "asc" }],
      select: { id: true, nome: true, descricao: true, ativo: true, agenteIaId: true, _count: { select: { atendentes: true } } },
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
      // Root vincula qualquer usuário; admin só os que pode gerenciar (padrão) e ele mesmo.
      where: { ativo: true, atendente: null, ...(ator.role === "root" ? {} : { OR: [{ role: "padrao" }, { id: ator.id }] }) },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, username: true, role: true },
    }),
    prisma.noCodeFlow.findMany({
      where: { tipo: "bot" },
      orderBy: [{ ativo: "desc" }, { nome: "asc" }],
      select: { id: true, nome: true, ativo: true, botEntrada: true, departamentoId: true, nodes: true },
    }),
    agentesIaAtivo
      ? prisma.agenteIA.findMany({ orderBy: [{ ativo: "desc" }, { nome: "asc" }], select: { id: true, nome: true, ativo: true, entrada: true } })
      : Promise.resolve([]),
  ])

  const paraBotItem = (b: (typeof bots)[number]): BotItem => ({
    id: b.id,
    nome: b.nome,
    ativo: b.ativo,
    totalBlocos: Array.isArray(b.nodes) ? b.nodes.length : 0,
  })

  const porDepartamento = new Map<string, number>()
  for (const linha of conversasPorDepartamento) {
    if (linha.departamentoId) porDepartamento.set(linha.departamentoId, linha._count._all)
  }
  const porAtendente = new Map<string, number>()
  for (const linha of conversasPorAtendente) {
    if (linha.atendenteId) porAtendente.set(linha.atendenteId, linha._count._all)
  }

  return {
    botsEntrada: bots.filter((b) => b.botEntrada).map(paraBotItem),
    departamentos: departamentos.map((d) => ({
      id: d.id,
      nome: d.nome,
      descricao: d.descricao,
      ativo: d.ativo,
      totalAtendentes: d._count.atendentes,
      totalConversas: porDepartamento.get(d.id) ?? 0,
      bots: bots.filter((b) => b.departamentoId === d.id).map(paraBotItem),
      agenteIaId: d.agenteIaId,
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
      acessaChat: podeAcessar({ role: a.user.role, secoes: a.user.secoes }, "chat"),
    })),
    usuariosDisponiveis: usuarios,
    agentesIaAtivo,
    agentesIa: agentesIa.map((a) => ({ id: a.id, nome: a.nome, ativo: a.ativo })),
    agenteIaEntradaId: agentesIa.find((a) => a.entrada)?.id ?? null,
  }
}

// ---------------------------------------------------------------------------
// Integração com o chat
// ---------------------------------------------------------------------------

/** Departamentos e atendentes ATIVOS, que podem receber uma transferência. */
export async function getCrmChatOpcoes(usuarioId: string, admin = false): Promise<CrmChatOpcoes> {
  const [departamentos, atendentes, meu, campanhas] = await Promise.all([
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
    prisma.atendente.findUnique({
      where: { userId: usuarioId },
      select: { id: true, ativo: true, departamentos: { select: { departamentoId: true } } },
    }),
    listCampanhasAbertas(),
  ])

  return {
    departamentos,
    campanhas,
    atendentes: atendentes.map((a) => ({
      id: a.id,
      nome: a.user.nome,
      role: a.user.role,
      departamentoIds: a.departamentos.map((v) => v.departamentoId),
    })),
    meuAtendenteId: meu?.id ?? null,
    contexto: {
      admin,
      atendenteId: meu?.id ?? null,
      atendenteAtivo: Boolean(meu?.ativo),
      departamentoIds: meu?.ativo ? meu.departamentos.map((v) => v.departamentoId) : [],
    },
  }
}

/** Contexto de permissão de um usuário (usado nas ações do servidor). */
export async function getContextoAtendimento(usuario: { id: string; role: UserRole }): Promise<ContextoAtendimento> {
  const meu = await prisma.atendente.findUnique({
    where: { userId: usuario.id },
    select: { id: true, ativo: true, departamentos: { select: { departamentoId: true } } },
  })
  return {
    // Root e admin podem atuar em qualquer conversa (desde que tenham a seção Chat).
    admin: usuario.role !== "padrao",
    atendenteId: meu?.id ?? null,
    atendenteAtivo: Boolean(meu?.ativo),
    departamentoIds: meu?.ativo ? meu.departamentos.map((v) => v.departamentoId) : [],
  }
}

/**
 * Separa os leads em que o usuário pode enviar mensagem dos bloqueados.
 * Com o plugin CRM desativado não há restrição.
 */
export async function filtrarLeadsParaEnvio(
  leadIds: string[],
  usuario: { id: string; role: UserRole },
): Promise<{ permitidos: string[]; bloqueados: { leadId: string; motivo: string }[] }> {
  if (leadIds.length === 0) return { permitidos: [], bloqueados: [] }
  if (!(await getCrmPluginAtivo())) return { permitidos: leadIds, bloqueados: [] }

  const [ctx, linhas] = await Promise.all([
    getContextoAtendimento(usuario),
    prisma.leadAtendimento.findMany({
      where: { leadId: { in: leadIds } },
      select: {
        leadId: true,
        departamentoId: true,
        atendenteId: true,
        departamento: { select: { nome: true } },
        atendente: { select: { user: { select: { nome: true } } } },
      },
    }),
  ])
  const porLead = new Map(linhas.map((l) => [l.leadId, l]))

  const permitidos: string[] = []
  const bloqueados: { leadId: string; motivo: string }[] = []
  for (const leadId of leadIds) {
    const l = porLead.get(leadId)
    const r = avaliarAtendimento(
      l
        ? {
            departamentoId: l.departamentoId,
            atendenteId: l.atendenteId,
            departamentoNome: l.departamento?.nome ?? null,
            atendenteNome: l.atendente?.user.nome ?? null,
          }
        : null,
      ctx,
    )
    if (r.podeEnviar) permitidos.push(leadId)
    else bloqueados.push({ leadId, motivo: r.motivo ?? "Sem permissão para enviar nesta conversa." })
  }
  return { permitidos, bloqueados }
}

/**
 * Assume uma conversa que está num departamento sem responsável. A atualização
 * é condicional: se duas pessoas clicarem ao mesmo tempo, só a primeira assume.
 */
export async function assumirConversa(
  leadId: string,
  executor: { id: string; nome: string; role: UserRole },
): Promise<{ para: string }> {
  await exigirPlugin("crm")
  const [lead, atual, ctx] = await Promise.all([
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
    getContextoAtendimento(executor),
  ])
  if (!lead) throw new CrmError("Lead não encontrado.")
  if (!ctx.atendenteId || !ctx.atendenteAtivo) {
    throw new CrmError("Você precisa de um perfil de atendente ativo para assumir conversas.")
  }
  if (!atual || !atual.departamentoId) throw new CrmError("Esta conversa não está em nenhum departamento.")
  if (atual.atendenteId) {
    throw new CrmError(`Esta conversa já está com ${atual.atendente?.user.nome ?? "outro atendente"}.`)
  }
  if (!avaliarAtendimento({ departamentoId: atual.departamentoId, atendenteId: null }, ctx).podeAssumir) {
    throw new CrmError("Você não está vinculado a este departamento e não pode assumir a conversa.")
  }

  const de = rotuloResponsavel(atual.departamento?.nome, null)
  const para = rotuloResponsavel(atual.departamento?.nome, executor.nome)
  const nota = `Conversa assumida por ${executor.nome}: ${de} → ${para}.`

  const claim = await prisma.leadAtendimento.updateMany({
    where: { leadId, atendenteId: null, departamentoId: atual.departamentoId },
    data: { atendenteId: ctx.atendenteId, transferidoEm: new Date() },
  })
  if (claim.count === 0) throw new CrmError("Outra pessoa assumiu esta conversa antes de você.")

  await prisma.$transaction([
    prisma.atendimentoTransferencia.create({
      data: {
        leadId,
        deDepartamento: atual.departamento?.nome ?? null,
        paraDepartamento: atual.departamento?.nome ?? null,
        deAtendente: null,
        paraAtendente: executor.nome,
        porUsuario: executor.nome,
        motivo: "Conversa assumida",
      },
    }),
    prisma.chatInternalNote.create({ data: { leadId, texto: nota } }),
  ])

  // Um humano assumiu: o bot para de responder esta conversa até alguém reativá-lo.
  await pausarBotComNota(leadId, `Conversa assumida por ${executor.nome}.`)

  void emitWebhookEvent("atendimento.transferido", {
    leadId,
    leadNome: lead.nome,
    de: { departamento: atual.departamento?.nome ?? null, atendente: null },
    para: { departamento: atual.departamento?.nome ?? null, atendente: executor.nome },
    porUsuario: executor.nome,
    motivo: "Conversa assumida",
  })

  return { para }
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
  executor: { id: string; nome: string; role: UserRole },
): Promise<{ para: string }> {
  await exigirPlugin("crm")
  const departamentoId = limparTexto(input.departamentoId) || null
  const atendenteId = limparTexto(input.atendenteId) || null
  const motivo = limparTexto(input.motivo) || null

  // Sem departamento e sem atendente é válido: remove o vínculo e a conversa volta a ser livre.
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

  // Só o responsável (ou, sem responsável, quem atende o departamento) transfere.
  const permissoes = avaliarAtendimento(
    atual
      ? {
          departamentoId: atual.departamentoId,
          atendenteId: atual.atendenteId,
          departamentoNome: atual.departamento?.nome ?? null,
          atendenteNome: atual.atendente?.user.nome ?? null,
        }
      : null,
    await getContextoAtendimento(executor),
  )
  if (!permissoes.podeTransferir) {
    throw new CrmError(permissoes.motivo ?? "Você não pode transferir esta conversa.")
  }

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
    throw new CrmError(
      !departamentoId && !atendenteId
        ? "A conversa já está sem departamento e sem atendente."
        : "A conversa já está com esse departamento e atendente.",
    )
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

  // Transferir para uma pessoa = um humano passa a conduzir: pausa o bot. Para a fila de um
  // departamento (sem atendente) o bot do departamento continua valendo.
  if (atendente) await pausarBotComNota(leadId, `Conversa transferida para ${atendente.user.nome}.`)

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

// ---------------------------------------------------------------------------
// Bots nas conversas
// ---------------------------------------------------------------------------

/**
 * Pausa o bot e, quando ele estava ligado numa conversa em que já tinha falado, deixa uma
 * nota interna no chat para a equipe saber por que ele parou. Nunca derruba a ação principal.
 */
export async function pausarBotComNota(leadId: string, motivo: string): Promise<void> {
  try {
    // Pausar bot é função do CRM: com o plugin desativado não há bot nem nota a registrar.
    if (!(await getCrmPluginAtivo())) return
    const jaTinhaBot = Boolean(await prisma.botConversa.findUnique({ where: { leadId }, select: { leadId: true } }))
    const mudou = await pausarBot(leadId, motivo)
    if (mudou && jaTinhaBot) {
      await prisma.chatInternalNote.create({ data: { leadId, texto: `Bot pausado nesta conversa. ${motivo}` } })
    }
  } catch (error) {
    console.error("[crm] falha ao pausar o bot da conversa", error)
  }
}

/**
 * Liga ou pausa o bot numa conversa específica, a pedido de uma pessoa. Quem pode responder
 * a conversa (responsável, atendente do departamento ou admin) pode mexer no bot dela.
 */
export async function alternarBotConversa(
  leadId: string,
  ativo: boolean,
  executor: { id: string; nome: string; role: UserRole },
): Promise<void> {
  await exigirPlugin("crm")
  const [lead, atual, ctx] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } }),
    prisma.leadAtendimento.findUnique({
      where: { leadId },
      select: {
        departamentoId: true,
        atendenteId: true,
        departamento: { select: { nome: true } },
        atendente: { select: { user: { select: { nome: true } } } },
      },
    }),
    getContextoAtendimento(executor),
  ])
  if (!lead) throw new CrmError("Lead não encontrado.")

  const permissoes = avaliarAtendimento(
    atual
      ? {
          departamentoId: atual.departamentoId,
          atendenteId: atual.atendenteId,
          departamentoNome: atual.departamento?.nome ?? null,
          atendenteNome: atual.atendente?.user.nome ?? null,
        }
      : null,
    ctx,
  )
  if (!permissoes.podeEnviar) throw new CrmError(permissoes.motivo ?? "Você não pode alterar o bot desta conversa.")

  if (ativo) {
    await reativarBot(leadId)
    await prisma.chatInternalNote.create({ data: { leadId, texto: `Bot/agente de IA reativado nesta conversa por ${executor.nome}.` } })
  } else {
    await pausarBotComNota(leadId, `Pausado por ${executor.nome}.`)
  }
}

/**
 * Coloca a conversa na fila de um departamento, a pedido de um bot (bloco "Transferir para
 * departamento"). O departamento é achado pelo nome. Deixa o histórico e a nota interna.
 */
export async function transferirConversaPorBot(
  leadId: string,
  nomeDepartamento: string,
  opcoes: { pausarBot?: boolean; nomeBot?: string } = {},
): Promise<{ departamento: string }> {
  await exigirPlugin("crm")
  const nome = limparTexto(nomeDepartamento)
  if (!nome) throw new CrmError("Informe o departamento da transferência.")
  const nomeBot = opcoes.nomeBot ? `bot “${opcoes.nomeBot}”` : "bot"

  const [departamento, atual] = await Promise.all([
    prisma.departamento.findFirst({
      where: { nome: { equals: nome, mode: "insensitive" } },
      select: { id: true, nome: true, ativo: true },
    }),
    prisma.leadAtendimento.findUnique({
      where: { leadId },
      select: { departamentoId: true, atendenteId: true, departamento: { select: { nome: true } }, atendente: { select: { user: { select: { nome: true } } } } },
    }),
  ])
  if (!departamento) throw new CrmError(`Departamento “${nome}” não encontrado em CRM → Departamentos.`)
  if (!departamento.ativo) throw new CrmError(`O departamento “${departamento.nome}” está inativo.`)
  if ((atual?.departamentoId ?? null) === departamento.id && !atual?.atendenteId) return { departamento: departamento.nome }

  const de = rotuloResponsavel(atual?.departamento?.nome, atual?.atendente?.user.nome)
  await prisma.$transaction([
    prisma.leadAtendimento.upsert({
      where: { leadId },
      create: { leadId, departamentoId: departamento.id, atendenteId: null },
      update: { departamentoId: departamento.id, atendenteId: null, transferidoEm: new Date() },
    }),
    prisma.atendimentoTransferencia.create({
      data: {
        leadId,
        deDepartamento: atual?.departamento?.nome ?? null,
        paraDepartamento: departamento.nome,
        deAtendente: atual?.atendente?.user.nome ?? null,
        paraAtendente: null,
        porUsuario: nomeBot,
        motivo: "Escolha do lead no menu do bot",
      },
    }),
    prisma.chatInternalNote.create({
      data: { leadId, texto: `Conversa transferida pelo ${nomeBot}: ${de} → ${departamento.nome}.` },
    }),
  ])

  if (opcoes.pausarBot) await pausarBotComNota(leadId, `Pausado pelo ${nomeBot} ao transferir para ${departamento.nome}.`)

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { nome: true } })
  void emitWebhookEvent("atendimento.transferido", {
    leadId,
    leadNome: lead?.nome ?? "",
    de: { departamento: atual?.departamento?.nome ?? null, atendente: atual?.atendente?.user.nome ?? null },
    para: { departamento: departamento.nome, atendente: null },
    porUsuario: nomeBot,
    motivo: "Escolha do lead no menu do bot",
  })

  return { departamento: departamento.nome }
}

/** Atendentes ativos (com usuário ativo e acesso ao chat), para escolher no bloco do No Code. */
export async function listAtendentesAtivos(): Promise<{ id: string; nome: string }[]> {
  const lista = await prisma.atendente.findMany({
    where: { ativo: true, user: { ativo: true } },
    orderBy: { user: { nome: "asc" } },
    select: { id: true, user: { select: { nome: true, role: true, secoes: true } } },
  })
  return lista
    .filter((a) => podeAcessar({ role: a.user.role, secoes: a.user.secoes }, "chat"))
    .map((a) => ({ id: a.id, nome: a.user.nome }))
}

/**
 * Passa a conversa para um atendente, a pedido de um bot (bloco "Transferir para atendente").
 *
 * - "especifico": o atendente escolhido, se ele estiver ativo e com acesso ao chat.
 * - "balanceado": entre os atendentes ativos (opcionalmente só os de um departamento), o que tem
 *   MENOS conversas atribuídas; em empate, sorteia. Ex.: com 5, 4 e 3 conversas, vai para o de 3.
 *   Se a conversa já é de um deles, ela não conta contra ele na comparação.
 *
 * Devolve `{ ok: false }` (sem lançar) quando não há atendente disponível, para o fluxo poder
 * seguir pela saída "Sem atendente". O bot é pausado na conversa: agora um humano conduz.
 */
export async function transferirParaAtendentePorBot(
  leadId: string,
  opcoes: { modo: "balanceado" | "especifico"; atendenteId?: string; departamento?: string; nomeBot?: string },
): Promise<{ ok: true; atendente: { id: string; nome: string }; departamento: string | null } | { ok: false; motivo: string }> {
  await exigirPlugin("crm")
  const nomeBot = opcoes.nomeBot ? `bot “${opcoes.nomeBot}”` : "bot"
  const nomeDepartamento = limparTexto(opcoes.departamento)

  const [atual, departamento] = await Promise.all([
    prisma.leadAtendimento.findUnique({
      where: { leadId },
      select: { departamentoId: true, atendenteId: true, departamento: { select: { nome: true } }, atendente: { select: { user: { select: { nome: true } } } } },
    }),
    opcoes.modo === "balanceado" && nomeDepartamento
      ? prisma.departamento.findFirst({
          where: { nome: { equals: nomeDepartamento, mode: "insensitive" } },
          select: { id: true, nome: true, ativo: true },
        })
      : Promise.resolve(null),
  ])
  if (opcoes.modo === "balanceado" && nomeDepartamento) {
    if (!departamento) throw new CrmError(`Departamento “${nomeDepartamento}” não encontrado em CRM → Departamentos.`)
    if (!departamento.ativo) throw new CrmError(`O departamento “${departamento.nome}” está inativo.`)
  }

  const candidatosBrutos = await prisma.atendente.findMany({
    where: {
      ativo: true,
      user: { ativo: true },
      ...(opcoes.modo === "especifico" ? { id: limparTexto(opcoes.atendenteId) } : {}),
      ...(departamento ? { departamentos: { some: { departamentoId: departamento.id } } } : {}),
    },
    select: { id: true, user: { select: { nome: true, role: true, secoes: true } } },
  })
  const candidatos = candidatosBrutos.filter((a) => podeAcessar({ role: a.user.role, secoes: a.user.secoes }, "chat"))
  if (candidatos.length === 0) {
    return {
      ok: false,
      motivo:
        opcoes.modo === "especifico"
          ? "O atendente escolhido está inativo ou sem acesso ao chat."
          : departamento
            ? `Nenhum atendente ativo no departamento “${departamento.nome}”.`
            : "Nenhum atendente ativo disponível.",
    }
  }

  let escolhido = candidatos[0]
  if (candidatos.length > 1) {
    const cargas = await prisma.leadAtendimento.groupBy({
      by: ["atendenteId"],
      where: { atendenteId: { in: candidatos.map((a) => a.id) } },
      _count: { _all: true },
    })
    const carga = new Map<string, number>()
    for (const linha of cargas) if (linha.atendenteId) carga.set(linha.atendenteId, linha._count._all)
    // A conversa que está sendo redistribuída não pesa contra quem já está com ela.
    if (atual?.atendenteId && carga.has(atual.atendenteId)) carga.set(atual.atendenteId, (carga.get(atual.atendenteId) ?? 1) - 1)
    const menor = Math.min(...candidatos.map((a) => carga.get(a.id) ?? 0))
    const empatados = candidatos.filter((a) => (carga.get(a.id) ?? 0) === menor)
    escolhido = empatados[Math.floor(Math.random() * empatados.length)]
  }

  const departamentoIdFinal = departamento?.id ?? atual?.departamentoId ?? null
  const departamentoNomeFinal = departamento?.nome ?? atual?.departamento?.nome ?? null
  const de = rotuloResponsavel(atual?.departamento?.nome, atual?.atendente?.user.nome)
  const para = rotuloResponsavel(departamentoNomeFinal, escolhido.user.nome)
  const motivo = opcoes.modo === "balanceado" ? "Distribuição automática pelo bot" : "Escolha do bot"

  await prisma.$transaction([
    prisma.leadAtendimento.upsert({
      where: { leadId },
      create: { leadId, departamentoId: departamentoIdFinal, atendenteId: escolhido.id },
      update: { departamentoId: departamentoIdFinal, atendenteId: escolhido.id, transferidoEm: new Date() },
    }),
    prisma.atendimentoTransferencia.create({
      data: {
        leadId,
        deDepartamento: atual?.departamento?.nome ?? null,
        paraDepartamento: departamentoNomeFinal,
        deAtendente: atual?.atendente?.user.nome ?? null,
        paraAtendente: escolhido.user.nome,
        porUsuario: nomeBot,
        motivo,
      },
    }),
    prisma.chatInternalNote.create({
      data: { leadId, texto: `Conversa transferida pelo ${nomeBot}: ${de} → ${para}. ${motivo}.` },
    }),
  ])

  await pausarBotComNota(leadId, `Conversa transferida pelo ${nomeBot} para ${escolhido.user.nome}.`)

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { nome: true } })
  void emitWebhookEvent("atendimento.transferido", {
    leadId,
    leadNome: lead?.nome ?? "",
    de: { departamento: atual?.departamento?.nome ?? null, atendente: atual?.atendente?.user.nome ?? null },
    para: { departamento: departamentoNomeFinal, atendente: escolhido.user.nome },
    porUsuario: nomeBot,
    motivo,
  })

  return { ok: true, atendente: { id: escolhido.id, nome: escolhido.user.nome }, departamento: departamentoNomeFinal }
}
