import { prisma } from "@/lib/prisma"
import {
  FUNIL_DESCRICAO_MAX,
  FUNIL_ETAPAS_MAX,
  FUNIL_ETAPAS_MIN,
  FUNIL_ETAPAS_PADRAO,
  FUNIL_ETAPA_NOME_MAX,
  FUNIL_LIMITE_POR_COLUNA,
  FUNIL_NOME_MAX,
  FUNIL_VALOR_MAX,
  FUNIS_MAX,
  funilCorValida,
  funilTipoValido,
  type FunilBoardData,
  type FunilCartao,
  type FunilEtapaItem,
  type FunilEtapaTipo,
  type FunilResumo,
} from "@/lib/funis"
import { CrmError } from "@/services/crm"
import { exigirPlugin } from "@/services/settings"

/**
 * Plugin CRM — funis de vendas.
 *
 * Toda função começa com `exigirPlugin("crm")`: com o plugin desativado, os funis deixam de
 * funcionar de verdade (não só somem da tela). Os dados ficam guardados e voltam quando o plugin
 * é reativado.
 */

function limparTexto(valor: unknown): string {
  return typeof valor === "string" ? valor.replace(/\s+/g, " ").trim() : ""
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

function paraEtapaItem(e: { id: string; nome: string; cor: string; tipo: string; ordem: number }): FunilEtapaItem {
  return { id: e.id, nome: e.nome, cor: funilCorValida(e.cor), tipo: funilTipoValido(e.tipo), ordem: e.ordem }
}

export async function listarFunis(): Promise<FunilResumo[]> {
  await exigirPlugin("crm")
  const [funis, contagens] = await Promise.all([
    prisma.funil.findMany({
      orderBy: [{ ativo: "desc" }, { ordem: "asc" }, { nome: "asc" }],
      select: {
        id: true,
        nome: true,
        descricao: true,
        ativo: true,
        etapas: { orderBy: { ordem: "asc" }, select: { id: true, nome: true, cor: true, tipo: true, ordem: true } },
      },
    }),
    prisma.leadFunil.groupBy({ by: ["funilId"], _count: { _all: true } }),
  ])
  const porFunil = new Map(contagens.map((c) => [c.funilId, c._count._all]))
  return funis.map((f) => ({
    id: f.id,
    nome: f.nome,
    descricao: f.descricao,
    ativo: f.ativo,
    totalLeads: porFunil.get(f.id) ?? 0,
    etapas: f.etapas.map(paraEtapaItem),
  }))
}

export async function getFunilBoard(funilId: string): Promise<FunilBoardData | null> {
  await exigirPlugin("crm")
  const funil = await prisma.funil.findUnique({
    where: { id: funilId },
    select: {
      id: true,
      nome: true,
      descricao: true,
      ativo: true,
      etapas: { orderBy: { ordem: "asc" }, select: { id: true, nome: true, cor: true, tipo: true, ordem: true } },
    },
  })
  if (!funil) return null

  const [somas, porEtapa] = await Promise.all([
    prisma.leadFunil.groupBy({ by: ["etapaId"], where: { funilId }, _count: { _all: true }, _sum: { valor: true } }),
    Promise.all(
      funil.etapas.map((etapa) =>
        prisma.leadFunil.findMany({
          where: { funilId, etapaId: etapa.id },
          orderBy: [{ movidoEm: "desc" }, { id: "asc" }],
          take: FUNIL_LIMITE_POR_COLUNA,
          select: {
            id: true,
            leadId: true,
            etapaId: true,
            valor: true,
            movidoEm: true,
            lead: { select: { nome: true, telefone: true, produto: true, marca: true } },
          },
        }),
      ),
    ),
  ])

  const etapas = funil.etapas.map(paraEtapaItem)
  const totais: FunilBoardData["totais"] = Object.fromEntries(etapas.map((e) => [e.id, { total: 0, valor: 0 }]))
  for (const linha of somas) totais[linha.etapaId] = { total: linha._count._all, valor: linha._sum.valor ?? 0 }

  const leads: FunilCartao[] = porEtapa.flat().map((v) => ({
    id: v.id,
    leadId: v.leadId,
    etapaId: v.etapaId,
    nome: v.lead.nome,
    telefone: v.lead.telefone,
    produto: v.lead.produto,
    marca: v.lead.marca,
    valor: v.valor,
    movidoEm: v.movidoEm.toISOString(),
  }))

  const resumo: FunilBoardData["resumo"] = {
    emAndamento: 0,
    ganhos: 0,
    perdidos: 0,
    valorEmAndamento: 0,
    valorGanho: 0,
    conversao: null,
  }
  for (const etapa of etapas) {
    const t = totais[etapa.id]
    if (etapa.tipo === "ganho") {
      resumo.ganhos += t.total
      resumo.valorGanho += t.valor
    } else if (etapa.tipo === "perdido") {
      resumo.perdidos += t.total
    } else {
      resumo.emAndamento += t.total
      resumo.valorEmAndamento += t.valor
    }
  }
  const encerrados = resumo.ganhos + resumo.perdidos
  resumo.conversao = encerrados > 0 ? (resumo.ganhos / encerrados) * 100 : null

  return {
    funil: {
      id: funil.id,
      nome: funil.nome,
      descricao: funil.descricao,
      ativo: funil.ativo,
      totalLeads: somas.reduce((acc, l) => acc + l._count._all, 0),
      etapas,
    },
    leads,
    totais,
    limitePorColuna: FUNIL_LIMITE_POR_COLUNA,
    resumo,
  }
}

/** Leads que ainda não estão no funil, para o diálogo "Adicionar lead". */
export async function buscarLeadsParaFunil(
  funilId: string,
  termo: string,
): Promise<{ id: string; nome: string; telefone: string }[]> {
  await exigirPlugin("crm")
  const busca = limparTexto(termo).slice(0, 80)
  return prisma.lead.findMany({
    where: {
      funis: { none: { funilId } },
      ...(busca
        ? { OR: [{ nome: { contains: busca, mode: "insensitive" } }, { telefone: { contains: busca.replace(/\D/g, "") || busca } }] }
        : {}),
    },
    orderBy: { atualizadoEm: "desc" },
    take: 15,
    select: { id: true, nome: true, telefone: true },
  })
}

// ---------------------------------------------------------------------------
// Funis
// ---------------------------------------------------------------------------

export type FunilInput = { nome: string; descricao?: string | null; ativo?: boolean }

function validarFunil(input: FunilInput) {
  const nome = limparTexto(input.nome)
  const descricao = limparTexto(input.descricao) || null
  if (nome.length < 2) throw new CrmError("Informe o nome do funil (mínimo de 2 caracteres).")
  if (nome.length > FUNIL_NOME_MAX) throw new CrmError(`O nome pode ter no máximo ${FUNIL_NOME_MAX} caracteres.`)
  if (descricao && descricao.length > FUNIL_DESCRICAO_MAX) {
    throw new CrmError(`A descrição pode ter no máximo ${FUNIL_DESCRICAO_MAX} caracteres.`)
  }
  return { nome, descricao, ativo: input.ativo === undefined ? true : Boolean(input.ativo) }
}

async function garantirNomeLivre(nome: string, ignorarId?: string) {
  const duplicado = await prisma.funil.findFirst({
    where: { nome: { equals: nome, mode: "insensitive" }, ...(ignorarId ? { id: { not: ignorarId } } : {}) },
    select: { id: true },
  })
  if (duplicado) throw new CrmError("Já existe um funil com esse nome.")
}

export async function criarFunil(input: FunilInput): Promise<{ id: string }> {
  await exigirPlugin("crm")
  const dados = validarFunil(input)
  await garantirNomeLivre(dados.nome)
  if ((await prisma.funil.count()) >= FUNIS_MAX) throw new CrmError(`O limite é de ${FUNIS_MAX} funis.`)

  const ultimo = await prisma.funil.aggregate({ _max: { ordem: true } })
  const funil = await prisma.funil.create({
    data: {
      ...dados,
      ordem: (ultimo._max.ordem ?? -1) + 1,
      etapas: { create: FUNIL_ETAPAS_PADRAO.map((e, ordem) => ({ nome: e.nome, cor: e.cor, tipo: e.tipo, ordem })) },
    },
    select: { id: true },
  })
  return funil
}

export async function atualizarFunil(id: string, input: FunilInput): Promise<void> {
  await exigirPlugin("crm")
  const dados = validarFunil(input)
  const atual = await prisma.funil.findUnique({ where: { id }, select: { id: true, ativo: true } })
  if (!atual) throw new CrmError("Funil não encontrado.")
  await garantirNomeLivre(dados.nome, id)
  await prisma.funil.update({
    where: { id },
    data: { nome: dados.nome, descricao: dados.descricao, ativo: input.ativo === undefined ? atual.ativo : dados.ativo },
  })
}

/** Exclui o funil, as etapas e os vínculos. Os leads permanecem. */
export async function excluirFunil(id: string): Promise<{ leads: number }> {
  await exigirPlugin("crm")
  const atual = await prisma.funil.findUnique({ where: { id }, select: { id: true } })
  if (!atual) throw new CrmError("Funil não encontrado.")
  const leads = await prisma.leadFunil.count({ where: { funilId: id } })
  await prisma.funil.delete({ where: { id } })
  return { leads }
}

// ---------------------------------------------------------------------------
// Etapas
// ---------------------------------------------------------------------------

export type EtapaInput = { id?: string | null; nome: string; cor: string; tipo: FunilEtapaTipo | string }

/**
 * Salva a lista completa de etapas, na ordem recebida: as que têm `id` são atualizadas, as sem `id`
 * são criadas e as que sumiram da lista são removidas. Os leads de uma etapa removida vão para
 * `destinoId` (obrigatório quando há leads nelas).
 */
export async function salvarEtapas(
  funilId: string,
  etapas: EtapaInput[],
  destinoId: string | null,
  porUsuario: string,
): Promise<{ movidos: number }> {
  await exigirPlugin("crm")
  const funil = await prisma.funil.findUnique({
    where: { id: funilId },
    select: { nome: true, etapas: { select: { id: true, nome: true } } },
  })
  if (!funil) throw new CrmError("Funil não encontrado.")

  if (!Array.isArray(etapas) || etapas.length < FUNIL_ETAPAS_MIN) {
    throw new CrmError(`O funil precisa ter pelo menos ${FUNIL_ETAPAS_MIN} etapas.`)
  }
  if (etapas.length > FUNIL_ETAPAS_MAX) throw new CrmError(`O funil pode ter no máximo ${FUNIL_ETAPAS_MAX} etapas.`)

  const existentes = new Map(funil.etapas.map((e) => [e.id, e.nome]))
  const normalizadas = etapas.map((e) => {
    const nome = limparTexto(e.nome)
    if (!nome) throw new CrmError("Toda etapa precisa de um nome.")
    if (nome.length > FUNIL_ETAPA_NOME_MAX) throw new CrmError(`O nome da etapa pode ter no máximo ${FUNIL_ETAPA_NOME_MAX} caracteres.`)
    const id = typeof e.id === "string" && e.id ? e.id : null
    if (id && !existentes.has(id)) throw new CrmError("Alguma etapa não existe mais. Atualize a página.")
    return { id, nome, cor: funilCorValida(e.cor), tipo: funilTipoValido(e.tipo) }
  })

  const idsMantidos = normalizadas.map((e) => e.id).filter((id): id is string => id !== null)
  if (new Set(idsMantidos).size !== idsMantidos.length) throw new CrmError("Etapa repetida na lista.")
  const nomes = normalizadas.map((e) => e.nome.toLowerCase())
  if (new Set(nomes).size !== nomes.length) throw new CrmError("Duas etapas não podem ter o mesmo nome.")
  if (!normalizadas.some((e) => e.tipo === "aberta")) throw new CrmError("Mantenha pelo menos uma etapa “Em andamento”.")

  const removidas = funil.etapas.filter((e) => !idsMantidos.includes(e.id))
  const comLeads = removidas.length
    ? await prisma.leadFunil.groupBy({ by: ["etapaId"], where: { funilId, etapaId: { in: removidas.map((e) => e.id) } }, _count: { _all: true } })
    : []
  const leadsAMover = comLeads.reduce((acc, l) => acc + l._count._all, 0)

  if (leadsAMover > 0) {
    if (!destinoId || !idsMantidos.includes(destinoId)) {
      throw new CrmError("Escolha para qual etapa os leads das etapas removidas devem ir.")
    }
  }

  // Cria primeiro as etapas novas (precisamos dos ids para o destino e para o histórico).
  const ids: string[] = []
  for (const [ordem, e] of normalizadas.entries()) {
    if (e.id) {
      await prisma.funilEtapa.update({ where: { id: e.id }, data: { nome: e.nome, cor: e.cor, tipo: e.tipo, ordem } })
      ids.push(e.id)
    } else {
      const criada = await prisma.funilEtapa.create({ data: { funilId, nome: e.nome, cor: e.cor, tipo: e.tipo, ordem }, select: { id: true } })
      ids.push(criada.id)
    }
  }

  if (leadsAMover > 0 && destinoId) {
    const destinoNome = normalizadas.find((e) => e.id === destinoId)?.nome ?? null
    const afetados = await prisma.leadFunil.findMany({
      where: { funilId, etapaId: { in: removidas.map((e) => e.id) } },
      select: { leadId: true, etapaId: true },
    })
    await prisma.leadFunil.updateMany({
      where: { funilId, etapaId: { in: removidas.map((e) => e.id) } },
      data: { etapaId: destinoId, movidoEm: new Date() },
    })
    await prisma.leadFunilMovimento.createMany({
      data: afetados.map((a) => ({
        leadId: a.leadId,
        funil: funil.nome,
        deEtapa: existentes.get(a.etapaId) ?? null,
        paraEtapa: destinoNome,
        porUsuario,
      })),
    })
  }

  if (removidas.length) await prisma.funilEtapa.deleteMany({ where: { funilId, id: { in: removidas.map((e) => e.id) } } })
  return { movidos: leadsAMover }
}

// ---------------------------------------------------------------------------
// Leads no funil
// ---------------------------------------------------------------------------

function validarValor(valor: number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor < 0) throw new CrmError("Informe um valor válido (zero ou maior).")
  if (valor > FUNIL_VALOR_MAX) throw new CrmError("O valor informado é muito alto.")
  return Math.round(valor * 100) / 100
}

export async function adicionarLeadAoFunil(
  funilId: string,
  leadId: string,
  opcoes: { etapaId?: string | null; valor?: number | null },
  porUsuario: string,
): Promise<void> {
  await exigirPlugin("crm")
  const funil = await prisma.funil.findUnique({
    where: { id: funilId },
    select: { nome: true, ativo: true, etapas: { orderBy: { ordem: "asc" }, select: { id: true, nome: true } } },
  })
  if (!funil) throw new CrmError("Funil não encontrado.")
  if (!funil.ativo) throw new CrmError("O funil está inativo. Ative-o para adicionar leads.")

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } })
  if (!lead) throw new CrmError("Lead não encontrado.")
  const jaEsta = await prisma.leadFunil.findFirst({ where: { funilId, leadId }, select: { id: true } })
  if (jaEsta) throw new CrmError("Este lead já está no funil.")

  const etapa = opcoes.etapaId ? funil.etapas.find((e) => e.id === opcoes.etapaId) : funil.etapas[0]
  if (!etapa) throw new CrmError("Etapa não encontrada.")
  const valor = validarValor(opcoes.valor)

  await prisma.leadFunil.create({ data: { leadId, funilId, etapaId: etapa.id, valor } })
  await prisma.leadFunilMovimento.create({ data: { leadId, funil: funil.nome, deEtapa: null, paraEtapa: etapa.nome, porUsuario } })
}

export async function moverLeadNoFunil(funilId: string, leadId: string, etapaId: string, porUsuario: string): Promise<{ etapaNome: string }> {
  await exigirPlugin("crm")
  const vinculo = await prisma.leadFunil.findFirst({
    where: { funilId, leadId },
    select: { id: true, etapaId: true, etapa: { select: { nome: true } }, funil: { select: { nome: true, ativo: true } } },
  })
  if (!vinculo) throw new CrmError("Este lead não está no funil.")
  if (!vinculo.funil.ativo) throw new CrmError("O funil está inativo.")
  const destino = await prisma.funilEtapa.findFirst({ where: { id: etapaId, funilId }, select: { id: true, nome: true } })
  if (!destino) throw new CrmError("Etapa não encontrada.")
  if (destino.id === vinculo.etapaId) return { etapaNome: destino.nome }

  await prisma.leadFunil.update({ where: { id: vinculo.id }, data: { etapaId: destino.id, movidoEm: new Date() } })
  await prisma.leadFunilMovimento.create({
    data: { leadId, funil: vinculo.funil.nome, deEtapa: vinculo.etapa.nome, paraEtapa: destino.nome, porUsuario },
  })
  return { etapaNome: destino.nome }
}

export async function definirValorNoFunil(funilId: string, leadId: string, valor: number | null): Promise<void> {
  await exigirPlugin("crm")
  const novo = validarValor(valor)
  const vinculo = await prisma.leadFunil.findFirst({ where: { funilId, leadId }, select: { id: true } })
  if (!vinculo) throw new CrmError("Este lead não está no funil.")
  await prisma.leadFunil.update({ where: { id: vinculo.id }, data: { valor: novo } })
}

export async function removerLeadDoFunil(funilId: string, leadId: string, porUsuario: string): Promise<void> {
  await exigirPlugin("crm")
  const vinculo = await prisma.leadFunil.findFirst({
    where: { funilId, leadId },
    select: { id: true, etapa: { select: { nome: true } }, funil: { select: { nome: true } } },
  })
  if (!vinculo) throw new CrmError("Este lead não está no funil.")
  await prisma.leadFunil.delete({ where: { id: vinculo.id } })
  await prisma.leadFunilMovimento.create({
    data: { leadId, funil: vinculo.funil.nome, deEtapa: vinculo.etapa.nome, paraEtapa: null, porUsuario },
  })
}

// ---------------------------------------------------------------------------
// Pontos de entrada fora da aba Funis: detalhe do lead, chat e aba Leads
// ---------------------------------------------------------------------------

export type FunilParaAdicionar = {
  id: string
  nome: string
  etapas: { id: string; nome: string }[]
}

/** Funis ativos com as etapas, para escolher onde colocar o(s) lead(s). */
export async function listarFunisParaAdicionar(): Promise<FunilParaAdicionar[]> {
  await exigirPlugin("crm")
  const funis = await prisma.funil.findMany({
    where: { ativo: true },
    orderBy: [{ ordem: "asc" }, { nome: "asc" }],
    select: { id: true, nome: true, etapas: { orderBy: { ordem: "asc" }, select: { id: true, nome: true } } },
  })
  return funis.filter((f) => f.etapas.length > 0)
}

const LEADS_POR_VEZ_MAX = 1000

/** Coloca vários leads no funil de uma vez. Quem já está no funil é ignorado (e contado). */
export async function adicionarLeadsAoFunil(
  funilId: string,
  leadIds: string[],
  opcoes: { etapaId?: string | null; valor?: number | null },
  porUsuario: string,
): Promise<{ adicionados: number; jaNoFunil: number }> {
  await exigirPlugin("crm")
  const ids = [...new Set((Array.isArray(leadIds) ? leadIds : []).filter((id): id is string => typeof id === "string" && id.length > 0))]
  if (ids.length === 0) throw new CrmError("Selecione pelo menos um lead.")
  if (ids.length > LEADS_POR_VEZ_MAX) throw new CrmError(`Selecione no máximo ${LEADS_POR_VEZ_MAX} leads por vez.`)

  const funil = await prisma.funil.findUnique({
    where: { id: funilId },
    select: { nome: true, ativo: true, etapas: { orderBy: { ordem: "asc" }, select: { id: true, nome: true } } },
  })
  if (!funil) throw new CrmError("Funil não encontrado.")
  if (!funil.ativo) throw new CrmError("O funil está inativo. Ative-o para adicionar leads.")
  const etapa = opcoes.etapaId ? funil.etapas.find((e) => e.id === opcoes.etapaId) : funil.etapas[0]
  if (!etapa) throw new CrmError("Etapa não encontrada.")
  const valor = validarValor(opcoes.valor)

  const [leads, existentes] = await Promise.all([
    prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    prisma.leadFunil.findMany({ where: { funilId, leadId: { in: ids } }, select: { leadId: true } }),
  ])
  if (leads.length === 0) throw new CrmError("Lead não encontrado.")
  const jaEsta = new Set(existentes.map((e) => e.leadId))
  const novos = leads.map((l) => l.id).filter((id) => !jaEsta.has(id))

  if (novos.length > 0) {
    await prisma.leadFunil.createMany({ data: novos.map((leadId) => ({ leadId, funilId, etapaId: etapa.id, valor })) })
    await prisma.leadFunilMovimento.createMany({
      data: novos.map((leadId) => ({ leadId, funil: funil.nome, deEtapa: null, paraEtapa: etapa.nome, porUsuario })),
    })
  }
  return { adicionados: novos.length, jaNoFunil: leads.length - novos.length }
}

export type LeadFunilVinculo = {
  funilId: string
  funilNome: string
  funilAtivo: boolean
  etapaId: string
  valor: number | null
  movidoEm: string
  etapas: { id: string; nome: string; cor: ReturnType<typeof funilCorValida>; tipo: FunilEtapaTipo }[]
}

export type LeadFunilMovimentoItem = {
  id: string
  funil: string
  deEtapa: string | null
  paraEtapa: string | null
  porUsuario: string
  data: string
}

/** Funis em que o lead está (com as etapas, para mover) e os últimos movimentos. Tela de detalhe do lead. */
export async function getFunisDoLead(leadId: string): Promise<{ vinculos: LeadFunilVinculo[]; movimentos: LeadFunilMovimentoItem[] }> {
  await exigirPlugin("crm")
  const [vinculos, movimentos] = await Promise.all([
    prisma.leadFunil.findMany({
      where: { leadId },
      orderBy: { criadoEm: "asc" },
      select: {
        funilId: true,
        etapaId: true,
        valor: true,
        movidoEm: true,
        funil: {
          select: {
            nome: true,
            ativo: true,
            etapas: { orderBy: { ordem: "asc" }, select: { id: true, nome: true, cor: true, tipo: true } },
          },
        },
      },
    }),
    prisma.leadFunilMovimento.findMany({ where: { leadId }, orderBy: { data: "desc" }, take: 15 }),
  ])
  return {
    vinculos: vinculos.map((v) => ({
      funilId: v.funilId,
      funilNome: v.funil.nome,
      funilAtivo: v.funil.ativo,
      etapaId: v.etapaId,
      valor: v.valor,
      movidoEm: v.movidoEm.toISOString(),
      etapas: v.funil.etapas.map((e) => ({ id: e.id, nome: e.nome, cor: funilCorValida(e.cor), tipo: funilTipoValido(e.tipo) })),
    })),
    movimentos: movimentos.map((m) => ({
      id: m.id,
      funil: m.funil,
      deEtapa: m.deEtapa,
      paraEtapa: m.paraEtapa,
      porUsuario: m.porUsuario,
      data: m.data.toISOString(),
    })),
  }
}
