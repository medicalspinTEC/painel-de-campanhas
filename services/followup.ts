import { Prisma } from "@/lib/generated/prisma/client"
import { avaliarAtendimento } from "@/lib/crm-permissoes"
import { renderTemplate } from "@/lib/format"
import { prisma } from "@/lib/prisma"
import type { UserRole } from "@/lib/permissoes"
import { paraCadaWorkspace } from "@/lib/workspace-context"
import { recordAppLog } from "@/services/app-logs"
import { CrmError, getContextoAtendimento } from "@/services/crm"
import {
  avaliarFollowUp,
  escolherTemplate,
  sequenciaAtual,
  type TemplateBasico,
} from "@/lib/followup-regras"
import { sendWhatsAppText } from "@/services/evolution"
import { exigirPlugin, getCrmPluginAtivo } from "@/services/settings"

/**
 * Bot especialista em FOLLOW-UP de um departamento.
 *
 * Regra: quando a última mensagem da conversa foi da equipe (humano, bot ou o próprio follow-up) e o
 * lead ficou `minutosSemResposta` sem responder, o bot envia um template. Cada departamento tem no
 * máximo um bot de follow-up, com vários templates; o bot escolhe o template de um destes jeitos:
 *   1. template escolhido manualmente para aquele chat (`FollowUpConversa.templateId`);
 *   2. modo "especifico": sempre o `templateFixoId` do bot;
 *   3. modo "aleatorio": sorteia entre os templates ativos (sem repetir o último usado no chat).
 *
 * Só atua em conversas: do departamento do bot; sem campanha (como os demais bots); cuja última
 * mensagem da equipe foi enviada DEPOIS de o bot ser ligado (ligar o bot não reabre conversas
 * antigas); e com o follow-up não desligado naquele chat. Quando o lead responde, a contagem zera.
 */

export type ModoTemplate = "aleatorio" | "especifico"

export type FollowUpTemplateItem = { id: string; nome: string; texto: string; ativo: boolean }

export type FollowUpBotItem = {
  id: string
  departamentoId: string
  nome: string
  ativo: boolean
  minutosSemResposta: number
  maxFollowUps: number
  modoTemplate: ModoTemplate
  templateFixoId: string | null
  janelaAtiva: boolean
  janelaInicio: number
  janelaFim: number
  templates: FollowUpTemplateItem[]
}

/** Situação do follow-up numa conversa (tela do chat). */
export type FollowUpChatInfo = {
  botId: string
  botNome: string
  botAtivo: boolean
  modoTemplate: ModoTemplate
  minutosSemResposta: number
  maxFollowUps: number
  /** Follow-up desligado só neste chat. */
  desativado: boolean
  /** Template escolhido manualmente para este chat (nulo = regra do bot). */
  templateId: string | null
  /** Templates ativos do bot, para escolher. */
  templates: Array<{ id: string; nome: string; texto: string }>
  /** Follow-ups já enviados desde a última resposta do lead. */
  enviados: number
  /** Quando o próximo follow-up sai (nulo = nada agendado). */
  proximoEm: string | null
  /** Por que nada está agendado / por que está parado. */
  motivo: string | null
}

/** Resumo por conversa, para a lista do chat. */
export type FollowUpResumo = { botAtivo: boolean; desativado: boolean; templateManual: boolean }

export const LIMITES_FOLLOWUP = {
  minutosMax: 60 * 24 * 30,
  maxFollowUpsMax: 5,
  nomeBotMax: 80,
  nomeTemplateMax: 60,
  textoTemplateMax: 4000,
} as const

/** Máximo de follow-ups enviados por bot a cada varredura (evita rajada ao ligar o bot ou após uma queda). */
const MAX_ENVIOS_POR_VARREDURA = 20
/** Pausa entre envios, para não disparar tudo no mesmo segundo. */
const PAUSA_ENTRE_ENVIOS_MS = 1500

const pausa = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// Gestão do bot (página do CRM)
// ---------------------------------------------------------------------------

type BotRow = Prisma.FollowUpBotGetPayload<{ include: { templates: true } }>

function paraItem(row: BotRow): FollowUpBotItem {
  return {
    id: row.id,
    departamentoId: row.departamentoId,
    nome: row.nome,
    ativo: row.ativo,
    minutosSemResposta: row.minutosSemResposta,
    maxFollowUps: row.maxFollowUps,
    modoTemplate: row.modoTemplate === "especifico" ? "especifico" : "aleatorio",
    templateFixoId: row.templateFixoId,
    janelaAtiva: row.janelaAtiva,
    janelaInicio: row.janelaInicio,
    janelaFim: row.janelaFim,
    templates: [...row.templates]
      .sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime())
      .map((t) => ({ id: t.id, nome: t.nome, texto: t.texto, ativo: t.ativo })),
  }
}

/** Bots de follow-up da instância (um por departamento). Vazio se a migration ainda não foi aplicada. */
export async function listarFollowUpBots(): Promise<FollowUpBotItem[]> {
  try {
    const rows = await prisma.followUpBot.findMany({ include: { templates: true }, orderBy: { criadoEm: "asc" } })
    return rows.map(paraItem)
  } catch (error) {
    // Tabela ainda não existe: a migration do follow-up não foi aplicada.
    if (typeof error === "object" && error !== null && "code" in error && (error.code === "P2021" || error.code === "P2022")) return []
    throw error
  }
}

function nomeValido(valor: unknown, rotulo: string, max: number): string {
  const nome = String(valor ?? "").trim()
  if (nome.length < 2 || nome.length > max) throw new CrmError(`Informe ${rotulo} (de 2 a ${max} caracteres).`)
  return nome
}

export async function criarFollowUpBot(input: { departamentoId: string; nome?: string | null }): Promise<{ id: string }> {
  await exigirPlugin("crm")
  const departamento = await prisma.departamento.findUnique({
    where: { id: input.departamentoId },
    select: { id: true, nome: true, followUpBot: { select: { id: true } } },
  })
  if (!departamento) throw new CrmError("Departamento não encontrado.")
  if (departamento.followUpBot) throw new CrmError("Este departamento já tem um bot de follow-up.")
  const nome = nomeValido(input.nome?.trim() || `Follow-up ${departamento.nome}`, "o nome do bot", LIMITES_FOLLOWUP.nomeBotMax)
  const bot = await prisma.followUpBot.create({ data: { departamentoId: departamento.id, nome } })
  return { id: bot.id }
}

export type FollowUpBotInput = {
  nome: string
  minutosSemResposta: number
  maxFollowUps: number
  modoTemplate: ModoTemplate
  templateFixoId: string | null
  janelaAtiva: boolean
  janelaInicio: number
  janelaFim: number
}

const inteiro = (valor: unknown) => (typeof valor === "number" && Number.isInteger(valor) ? valor : Number.NaN)

export async function salvarFollowUpBot(id: string, input: FollowUpBotInput): Promise<void> {
  await exigirPlugin("crm")
  const bot = await prisma.followUpBot.findUnique({ where: { id }, include: { templates: true } })
  if (!bot) throw new CrmError("Bot de follow-up não encontrado.")

  const nome = nomeValido(input.nome, "o nome do bot", LIMITES_FOLLOWUP.nomeBotMax)
  const minutos = inteiro(input.minutosSemResposta)
  if (!(minutos >= 1 && minutos <= LIMITES_FOLLOWUP.minutosMax)) {
    throw new CrmError("O tempo sem resposta deve ser de 1 minuto a 30 dias.")
  }
  const maxFollowUps = inteiro(input.maxFollowUps)
  if (!(maxFollowUps >= 1 && maxFollowUps <= LIMITES_FOLLOWUP.maxFollowUpsMax)) {
    throw new CrmError(`O limite de follow-ups seguidos deve ser de 1 a ${LIMITES_FOLLOWUP.maxFollowUpsMax}.`)
  }
  const modo: ModoTemplate = input.modoTemplate === "especifico" ? "especifico" : "aleatorio"

  let templateFixoId: string | null = null
  if (modo === "especifico") {
    const fixo = bot.templates.find((t) => t.id === input.templateFixoId)
    if (!fixo) throw new CrmError("Escolha o template que o bot vai usar.")
    if (!fixo.ativo) throw new CrmError("O template escolhido está desativado. Ative-o ou escolha outro.")
    templateFixoId = fixo.id
  }

  const janelaInicio = inteiro(input.janelaInicio)
  const janelaFim = inteiro(input.janelaFim)
  if (input.janelaAtiva) {
    if (!(janelaInicio >= 0 && janelaInicio <= 23 && janelaFim >= 1 && janelaFim <= 24 && janelaInicio < janelaFim)) {
      throw new CrmError("Janela de envio inválida: o início deve ser antes do fim (horas de 0 a 24).")
    }
  }

  await prisma.followUpBot.update({
    where: { id },
    data: {
      nome,
      minutosSemResposta: minutos,
      maxFollowUps,
      modoTemplate: modo,
      templateFixoId,
      janelaAtiva: Boolean(input.janelaAtiva),
      ...(input.janelaAtiva ? { janelaInicio, janelaFim } : {}),
    },
  })
}

export async function ativarFollowUpBot(id: string, ativo: boolean): Promise<void> {
  const bot = await prisma.followUpBot.findUnique({ where: { id }, include: { templates: true } })
  if (!bot) throw new CrmError("Bot de follow-up não encontrado.")
  if (!ativo) {
    await prisma.followUpBot.update({ where: { id }, data: { ativo: false } })
    return
  }
  await exigirPlugin("crm")
  const ativos = bot.templates.filter((t) => t.ativo)
  if (ativos.length === 0) throw new CrmError("Cadastre ao menos um template ativo antes de ligar o bot.")
  if (bot.modoTemplate === "especifico" && !ativos.some((t) => t.id === bot.templateFixoId)) {
    throw new CrmError("Escolha o template específico do bot (ou use o modo aleatório) antes de ligá-lo.")
  }
  // `ativadoEm` só muda quando o bot estava desligado: salvar de novo não reabre conversas antigas.
  await prisma.followUpBot.update({
    where: { id },
    data: { ativo: true, ...(bot.ativo ? {} : { ativadoEm: new Date() }) },
  })
}

export async function excluirFollowUpBot(id: string): Promise<void> {
  const apagados = await prisma.followUpBot.deleteMany({ where: { id } })
  if (apagados.count === 0) throw new CrmError("Bot de follow-up não encontrado.")
}

export type FollowUpTemplateInput = { id?: string | null; nome: string; texto: string; ativo: boolean }

export async function salvarFollowUpTemplate(botId: string, input: FollowUpTemplateInput): Promise<void> {
  await exigirPlugin("crm")
  const bot = await prisma.followUpBot.findUnique({ where: { id: botId }, select: { id: true, ativo: true, templateFixoId: true, modoTemplate: true } })
  if (!bot) throw new CrmError("Bot de follow-up não encontrado.")
  const nome = nomeValido(input.nome, "o nome do template", LIMITES_FOLLOWUP.nomeTemplateMax)
  const texto = String(input.texto ?? "").trim()
  if (!texto) throw new CrmError("Escreva a mensagem do template.")
  if (texto.length > LIMITES_FOLLOWUP.textoTemplateMax) {
    throw new CrmError(`A mensagem é muito longa (máximo de ${LIMITES_FOLLOWUP.textoTemplateMax} caracteres).`)
  }
  const ativo = Boolean(input.ativo)

  if (input.id) {
    const atual = await prisma.followUpTemplate.findFirst({ where: { id: input.id, botId } })
    if (!atual) throw new CrmError("Template não encontrado.")
    if (!ativo && bot.modoTemplate === "especifico" && bot.templateFixoId === atual.id) {
      throw new CrmError("Este é o template específico do bot. Escolha outro nas configurações antes de desativá-lo.")
    }
    if (!ativo && bot.ativo) await exigirOutroTemplateAtivo(botId, atual.id)
    await prisma.followUpTemplate.update({ where: { id: atual.id }, data: { nome, texto, ativo } })
    return
  }
  const total = await prisma.followUpTemplate.count({ where: { botId } })
  if (total >= 30) throw new CrmError("Limite de 30 templates por bot.")
  await prisma.followUpTemplate.create({ data: { botId, nome, texto, ativo } })
}

/** Bot ligado precisa de ao menos um template ativo além do que está saindo. */
async function exigirOutroTemplateAtivo(botId: string, ignorarId: string): Promise<void> {
  const outros = await prisma.followUpTemplate.count({ where: { botId, ativo: true, id: { not: ignorarId } } })
  if (outros === 0) throw new CrmError("O bot está ligado e precisa de ao menos um template ativo. Desligue o bot antes.")
}

export async function excluirFollowUpTemplate(id: string): Promise<void> {
  const template = await prisma.followUpTemplate.findUnique({
    where: { id },
    include: { bot: { select: { id: true, ativo: true, templateFixoId: true } } },
  })
  if (!template) throw new CrmError("Template não encontrado.")
  if (template.ativo && template.bot.ativo) await exigirOutroTemplateAtivo(template.bot.id, template.id)
  await prisma.followUpTemplate.delete({ where: { id } })
  // O template específico foi apagado: o bot volta ao modo aleatório em vez de ficar sem o que enviar.
  if (template.bot.templateFixoId === id) {
    await prisma.followUpBot.update({ where: { id: template.bot.id }, data: { templateFixoId: null, modoTemplate: "aleatorio" } })
  }
  // Chats que tinham este template escolhido voltam à regra do bot (FollowUpConversa.templateId vira nulo sozinho).
}

// ---------------------------------------------------------------------------
// Atividade das conversas (consulta única)
// ---------------------------------------------------------------------------

type Atividade = { ultimaEnviada: Date | null; ultimaResposta: Date | null }

/** Última mensagem da equipe e última resposta de cada lead, numa consulta só. */
async function atividadePorLead(leadIds: string[]): Promise<Map<string, Atividade>> {
  const mapa = new Map<string, Atividade>()
  if (leadIds.length === 0) return mapa
  const linhas = await prisma.$queryRaw<Array<{ leadId: string; ultimaEnviada: Date | null; ultimaResposta: Date | null }>>(Prisma.sql`
    SELECT e."leadId",
           MAX(e."data") FILTER (WHERE e."tipo"::text = 'mensagem_enviada') AS "ultimaEnviada",
           MAX(e."data") FILTER (WHERE e."tipo"::text = 'resposta') AS "ultimaResposta"
    FROM "TimelineEvent" e
    WHERE e."leadId" = ANY(${leadIds}::text[])
      AND e."tipo"::text IN ('mensagem_enviada', 'resposta')
    GROUP BY e."leadId"
  `)
  for (const linha of linhas) {
    mapa.set(linha.leadId, {
      ultimaEnviada: linha.ultimaEnviada ? new Date(linha.ultimaEnviada) : null,
      ultimaResposta: linha.ultimaResposta ? new Date(linha.ultimaResposta) : null,
    })
  }
  return mapa
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

type LeadEnvio = { id: string; nome: string; telefone: string }

/**
 * Reserva o envio (evita duplicar se duas varreduras se cruzarem), manda o template e registra no
 * chat. `contar: false` = envio manual: atualiza o "último envio" sem gastar o limite do bot.
 */
async function enviarTemplate(input: {
  bot: { id: string; nome: string }
  lead: LeadEnvio
  template: TemplateBasico
  conversa: { ultimoEnvioEm: Date | null } | null
  enviadosAntes: number
  contar: boolean
  origem: "automatico" | "manual"
}): Promise<{ ok: boolean; message: string }> {
  const { bot, lead, template, conversa, enviadosAntes, contar, origem } = input
  const agora = new Date()

  await prisma.followUpConversa.upsert({ where: { leadId: lead.id }, create: { leadId: lead.id }, update: {} })
  const reserva = await prisma.followUpConversa.updateMany({
    where: { leadId: lead.id, ultimoEnvioEm: conversa?.ultimoEnvioEm ?? null },
    data: { enviados: contar ? enviadosAntes + 1 : enviadosAntes, ultimoEnvioEm: agora, ultimoTemplateId: template.id },
  })
  if (reserva.count === 0) return { ok: false, message: "Outro envio de follow-up já está em andamento nesta conversa." }

  const texto = renderTemplate(template.texto.trim(), lead.nome.trim())
  const envio = await sendWhatsAppText({ telefone: lead.telefone, texto })

  if (!envio.ok) {
    await prisma.timelineEvent.create({
      data: {
        leadId: lead.id,
        campanhaId: null,
        mensagemId: null,
        tipo: "falha",
        descricao: `Falha ao enviar o follow-up do bot “${bot.nome}”.`,
        detalhes: envio.erro ?? null,
        sucesso: false,
      },
    })
    return { ok: false, message: envio.erro ?? "Não foi possível enviar o follow-up." }
  }

  await prisma.timelineEvent.create({
    data: {
      leadId: lead.id,
      campanhaId: null,
      mensagemId: null,
      tipo: "mensagem_enviada",
      descricao:
        origem === "automatico"
          ? `Follow-up automático do bot “${bot.nome}” (template “${template.nome}”).`
          : `Follow-up enviado manualmente (template “${template.nome}”).`,
      detalhes: `Mensagem: "${texto}"`,
      sucesso: true,
    },
  })
  return { ok: true, message: "Follow-up enviado." }
}

// ---------------------------------------------------------------------------
// Varredura (roda a cada minuto, para todas as instâncias)
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __followUpEmAndamento: boolean | undefined
}

async function varrerInstancia(agora: Date): Promise<number> {
  const bots = await prisma.followUpBot.findMany({
    where: { ativo: true, departamento: { ativo: true } },
    include: { templates: { where: { ativo: true } } },
  })
  let enviados = 0

  for (const bot of bots) {
    if (bot.templates.length === 0) continue
    const atendimentos = await prisma.leadAtendimento.findMany({
      where: { departamentoId: bot.departamentoId },
      select: { lead: { select: { id: true, nome: true, telefone: true, campanhaId: true, _count: { select: { campanhas: true } } } } },
    })
    if (atendimentos.length === 0) continue

    const leads = atendimentos.map((a) => a.lead)
    const ids = leads.map((l) => l.id)
    const [atividades, conversas] = await Promise.all([
      atividadePorLead(ids),
      prisma.followUpConversa.findMany({ where: { leadId: { in: ids } } }),
    ])
    const conversaPorLead = new Map(conversas.map((c) => [c.leadId, c]))

    let enviadosDoBot = 0
    for (const lead of leads) {
      if (enviadosDoBot >= MAX_ENVIOS_POR_VARREDURA) break
      const atividade = atividades.get(lead.id)
      if (!atividade) continue
      const conversa = conversaPorLead.get(lead.id) ?? null

      const avaliacao = avaliarFollowUp({
        bot,
        conversa,
        leadEmCampanha: Boolean(lead.campanhaId) || lead._count.campanhas > 0,
        ultimaEnviada: atividade.ultimaEnviada,
        ultimaResposta: atividade.ultimaResposta,
        agora,
      })
      if (!avaliacao.pode) continue

      const template = escolherTemplate(bot, bot.templates, conversa)
      if (!template) continue

      try {
        const resultado = await enviarTemplate({
          bot,
          lead,
          template,
          conversa,
          enviadosAntes: avaliacao.enviados,
          contar: true,
          origem: "automatico",
        })
        if (resultado.ok) {
          enviados++
          enviadosDoBot++
          await pausa(PAUSA_ENTRE_ENVIOS_MS)
        }
      } catch (error) {
        await recordAppLog({
          nivel: "erro",
          origem: "bots",
          mensagem: "Falha ao enviar o follow-up automático.",
          detalhes: error,
          contexto: { leadId: lead.id, botId: bot.id },
        })
      }
    }
  }
  return enviados
}

/** Varre todas as instâncias ativas e envia os follow-ups devidos. Uma varredura por vez neste processo. */
export async function processarFollowUps(agora = new Date()): Promise<{ enviados: number }> {
  if (globalThis.__followUpEmAndamento) return { enviados: 0 }
  globalThis.__followUpEmAndamento = true
  try {
    const parciais = await paraCadaWorkspace(
      async () => ((await getCrmPluginAtivo()) ? varrerInstancia(agora) : 0),
      (id, erro) => console.error(`[v0] falha na varredura de follow-up da instância ${id}:`, erro),
    )
    return { enviados: parciais.reduce((total, n) => total + n, 0) }
  } finally {
    globalThis.__followUpEmAndamento = false
  }
}

// ---------------------------------------------------------------------------
// Por conversa (chat)
// ---------------------------------------------------------------------------

/** Resumo do follow-up de cada conversa que tem departamento com bot (para a lista do chat). */
export async function listarResumoFollowUpPorLead(): Promise<Map<string, FollowUpResumo>> {
  const [bots, atendimentos, conversas] = await Promise.all([
    prisma.followUpBot.findMany({ select: { departamentoId: true, ativo: true } }),
    prisma.leadAtendimento.findMany({ where: { departamentoId: { not: null } }, select: { leadId: true, departamentoId: true } }),
    prisma.followUpConversa.findMany({ select: { leadId: true, desativado: true, templateId: true } }),
  ])
  const botPorDepartamento = new Map(bots.map((b) => [b.departamentoId, b]))
  const conversaPorLead = new Map(conversas.map((c) => [c.leadId, c]))
  const resumo = new Map<string, FollowUpResumo>()
  for (const a of atendimentos) {
    const bot = a.departamentoId ? botPorDepartamento.get(a.departamentoId) : undefined
    if (!bot) continue
    const conversa = conversaPorLead.get(a.leadId)
    resumo.set(a.leadId, {
      botAtivo: bot.ativo,
      desativado: conversa?.desativado ?? false,
      templateManual: Boolean(conversa?.templateId),
    })
  }
  return resumo
}

async function carregarContextoChat(leadId: string) {
  const atendimento = await prisma.leadAtendimento.findUnique({
    where: { leadId },
    select: {
      departamentoId: true,
      atendenteId: true,
      departamento: { select: { nome: true, followUpBot: { include: { templates: true } } } },
      atendente: { select: { user: { select: { nome: true } } } },
      lead: { select: { id: true, nome: true, telefone: true, campanhaId: true, _count: { select: { campanhas: true } } } },
    },
  })
  const bot = atendimento?.departamento?.followUpBot ?? null
  if (!atendimento || !bot) return null
  return { atendimento, bot }
}

/** Situação do follow-up na conversa. Nulo se o departamento da conversa não tem bot de follow-up. */
export async function getFollowUpChat(leadId: string): Promise<FollowUpChatInfo | null> {
  if (!(await getCrmPluginAtivo().catch(() => false))) return null
  let contexto: Awaited<ReturnType<typeof carregarContextoChat>>
  try {
    contexto = await carregarContextoChat(leadId)
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error.code === "P2021" || error.code === "P2022")) return null
    throw error
  }
  if (!contexto) return null
  const { atendimento, bot } = contexto
  const [atividades, conversa] = await Promise.all([
    atividadePorLead([leadId]),
    prisma.followUpConversa.findUnique({ where: { leadId } }),
  ])
  const atividade = atividades.get(leadId)
  const avaliacao = avaliarFollowUp({
    bot,
    conversa,
    leadEmCampanha: Boolean(atendimento.lead.campanhaId) || atendimento.lead._count.campanhas > 0,
    ultimaEnviada: atividade?.ultimaEnviada ?? null,
    ultimaResposta: atividade?.ultimaResposta ?? null,
    agora: new Date(),
  })
  const ativos = bot.templates.filter((t) => t.ativo)
  return {
    botId: bot.id,
    botNome: bot.nome,
    botAtivo: bot.ativo,
    modoTemplate: bot.modoTemplate === "especifico" ? "especifico" : "aleatorio",
    minutosSemResposta: bot.minutosSemResposta,
    maxFollowUps: bot.maxFollowUps,
    desativado: conversa?.desativado ?? false,
    templateId: conversa?.templateId && ativos.some((t) => t.id === conversa.templateId) ? conversa.templateId : null,
    templates: ativos.map((t) => ({ id: t.id, nome: t.nome, texto: t.texto })),
    enviados: avaliacao.enviados,
    proximoEm: avaliacao.proximoEm?.toISOString() ?? null,
    motivo: avaliacao.motivo,
  }
}

type Executor = { id: string; nome: string; role: UserRole }

/** Mesma regra do chat: só quem pode responder a conversa mexe no follow-up dela. */
async function exigirPodeAtuar(contexto: NonNullable<Awaited<ReturnType<typeof carregarContextoChat>>>, executor: Executor) {
  const ctx = await getContextoAtendimento(executor)
  const { atendimento } = contexto
  const permissoes = avaliarAtendimento(
    {
      departamentoId: atendimento.departamentoId,
      atendenteId: atendimento.atendenteId,
      departamentoNome: atendimento.departamento?.nome ?? null,
      atendenteNome: atendimento.atendente?.user.nome ?? null,
    },
    ctx,
  )
  if (!permissoes.podeEnviar) throw new CrmError(permissoes.motivo ?? "Você não pode alterar o follow-up desta conversa.")
}

async function contextoDaConversa(leadId: string, executor: Executor) {
  await exigirPlugin("crm")
  const contexto = await carregarContextoChat(leadId)
  if (!contexto) throw new CrmError("O departamento desta conversa não tem bot de follow-up.")
  await exigirPodeAtuar(contexto, executor)
  return contexto
}

/**
 * Ajustes do follow-up só deste chat: ligar/desligar e/ou escolher o template (`templateId: null`
 * volta à regra do bot). Campos não informados ficam como estão.
 */
export async function configurarFollowUpChat(
  leadId: string,
  ajustes: { desativado?: boolean; templateId?: string | null },
  executor: Executor,
): Promise<void> {
  const { bot } = await contextoDaConversa(leadId, executor)

  const dados: { desativado?: boolean; templateId?: string | null } = {}
  if (typeof ajustes.desativado === "boolean") dados.desativado = ajustes.desativado
  if (ajustes.templateId !== undefined) {
    if (ajustes.templateId !== null) {
      const template = bot.templates.find((t) => t.id === ajustes.templateId)
      if (!template || !template.ativo) throw new CrmError("Template não encontrado ou desativado.")
    }
    dados.templateId = ajustes.templateId
  }
  if (Object.keys(dados).length === 0) return
  await prisma.followUpConversa.upsert({ where: { leadId }, create: { leadId, ...dados }, update: dados })
}

/** Envia agora um template nesta conversa (o escolhido, ou o que a regra do bot indicar). */
export async function enviarFollowUpAgora(
  leadId: string,
  templateId: string | null,
  executor: Executor,
): Promise<{ ok: boolean; message: string }> {
  const { atendimento, bot } = await contextoDaConversa(leadId, executor)
  const ativos = bot.templates.filter((t) => t.ativo)
  const conversa = await prisma.followUpConversa.findUnique({ where: { leadId } })

  let template: TemplateBasico | null
  if (templateId) {
    template = ativos.find((t) => t.id === templateId) ?? null
    if (!template) throw new CrmError("Template não encontrado ou desativado.")
  } else {
    template = escolherTemplate(bot, ativos, conversa)
    if (!template) throw new CrmError("O bot não tem template ativo para enviar.")
  }

  const atividades = await atividadePorLead([leadId])
  const enviadosAntes = sequenciaAtual(conversa, atividades.get(leadId)?.ultimaResposta ?? null)
  return enviarTemplate({
    bot,
    lead: atendimento.lead,
    template,
    conversa,
    enviadosAntes,
    contar: false,
    origem: "manual",
  })
}
