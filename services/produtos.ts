import { prisma } from "@/lib/prisma"

export interface Produto {
  id: string
  nome: string
  descricao: string | null
  ativo: boolean
  idImportacao: string | null
  criadoEm: string
  atualizadoEm: string
}

export interface ProdutoInput {
  nome: string
  descricao?: string | null
  ativo?: boolean
  idImportacao?: string | null
}

type ProdutoRow = {
  id: string
  nome: string
  descricao: string | null
  ativo: boolean
  idImportacao: string | null
  criadoEm: Date
  atualizadoEm: Date
}

/**
 * O Prisma devolve `Date`; as páginas e componentes trabalham com ISO string
 * (serializável entre Server e Client Components).
 */
function serializar(row: ProdutoRow): Produto {
  return {
    id: row.id,
    nome: row.nome,
    descricao: row.descricao ?? null,
    ativo: row.ativo,
    idImportacao: row.idImportacao ?? null,
    criadoEm: row.criadoEm.toISOString(),
    atualizadoEm: row.atualizadoEm.toISOString(),
  }
}

/** Erro de nome duplicado, tratado na action para uma mensagem amigável. */
export class ProdutoDuplicadoError extends Error {
  constructor() {
    super("Já existe um produto com esse nome.")
    this.name = "ProdutoDuplicadoError"
  }
}

/** Erro de ID de importação duplicado, tratado na action. */
export class ProdutoIdImportacaoDuplicadoError extends Error {
  constructor() {
    super("Já existe um produto com esse ID de importação.")
    this.name = "ProdutoIdImportacaoDuplicadoError"
  }
}

export async function listProdutos(): Promise<Produto[]> {
  const rows = await prisma.produto.findMany({ orderBy: { nome: "asc" } })
  return rows.map(serializar)
}

/** Nomes dos produtos ativos, usados como opções ao criar/editar leads. */
export async function listNomesProdutosAtivos(): Promise<string[]> {
  const rows = await prisma.produto.findMany({
    where: { ativo: true },
    orderBy: { nome: "asc" },
    select: { nome: true },
  })
  return rows.map((r) => r.nome)
}

/**
 * Mapa de `idImportacao` normalizado (minúsculo) → nome do produto. Usado na
 * importação de leads para resolver o valor da planilha: se ele bater com um ID
 * de importação existente, aproveitamos o produto já cadastrado em vez de criar
 * uma segmentação nova.
 */
export async function mapProdutosPorIdImportacao(): Promise<Map<string, string>> {
  const rows = await prisma.produto.findMany({
    where: { idImportacao: { not: null } },
    select: { nome: true, idImportacao: true },
  })
  const mapa = new Map<string, string>()
  for (const r of rows) {
    if (r.idImportacao) mapa.set(r.idImportacao.trim().toLowerCase(), r.nome)
  }
  return mapa
}

export async function createProduto(input: ProdutoInput): Promise<Produto> {
  const existente = await prisma.produto.findUnique({ where: { nome: input.nome }, select: { id: true } })
  if (existente) throw new ProdutoDuplicadoError()

  const idImportacao = input.idImportacao?.trim() || null
  if (idImportacao) {
    const colisaoId = await prisma.produto.findUnique({ where: { idImportacao }, select: { id: true } })
    if (colisaoId) throw new ProdutoIdImportacaoDuplicadoError()
  }

  const row = await prisma.produto.create({
    data: {
      nome: input.nome,
      descricao: input.descricao?.trim() || null,
      ativo: input.ativo ?? true,
      idImportacao,
    },
  })
  return serializar(row)
}

export async function updateProduto(id: string, input: ProdutoInput): Promise<Produto | null> {
  const atual = await prisma.produto.findUnique({ where: { id }, select: { id: true } })
  if (!atual) return null

  // Impede colisão de nome com outro produto.
  const colisao = await prisma.produto.findFirst({
    where: { nome: input.nome, id: { not: id } },
    select: { id: true },
  })
  if (colisao) throw new ProdutoDuplicadoError()

  const idImportacao = input.idImportacao?.trim() || null
  if (idImportacao) {
    const colisaoId = await prisma.produto.findFirst({
      where: { idImportacao, id: { not: id } },
      select: { id: true },
    })
    if (colisaoId) throw new ProdutoIdImportacaoDuplicadoError()
  }

  const row = await prisma.produto.update({
    where: { id },
    data: {
      nome: input.nome,
      descricao: input.descricao?.trim() || null,
      ...(input.ativo !== undefined ? { ativo: input.ativo } : {}),
      ...(input.idImportacao !== undefined ? { idImportacao } : {}),
    },
  })
  return serializar(row)
}

export async function deleteProduto(id: string): Promise<void> {
  await prisma.produto.delete({ where: { id } })
}

/**
 * Garante que exista um produto ativo com este nome, cadastrando-o quando ainda
 * não existir. Usado pelo cadastro automático de segmentação quando um lead
 * chega com um produto que não está no catálogo. É idempotente: `nome` é
 * @unique no schema, então o upsert não duplica nem gera erro se já existir.
 */
export async function garantirProduto(nome: string): Promise<void> {
  const limpo = nome.trim()
  if (!limpo) return
  await prisma.produto.upsert({
    where: { nome: limpo },
    create: { nome: limpo, ativo: true },
    update: {},
  })
}
