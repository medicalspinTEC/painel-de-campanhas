import { prisma } from "@/lib/prisma"

export interface Produto {
  id: string
  nome: string
  descricao: string | null
  ativo: boolean
  criadoEm: string
  atualizadoEm: string
}

export interface ProdutoInput {
  nome: string
  descricao?: string | null
  ativo?: boolean
}

type ProdutoRow = {
  id: string
  nome: string
  descricao: string | null
  ativo: boolean
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

export async function createProduto(input: ProdutoInput): Promise<Produto> {
  const existente = await prisma.produto.findUnique({ where: { nome: input.nome }, select: { id: true } })
  if (existente) throw new ProdutoDuplicadoError()

  const row = await prisma.produto.create({
    data: {
      nome: input.nome,
      descricao: input.descricao?.trim() || null,
      ativo: input.ativo ?? true,
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

  const row = await prisma.produto.update({
    where: { id },
    data: {
      nome: input.nome,
      descricao: input.descricao?.trim() || null,
      ...(input.ativo !== undefined ? { ativo: input.ativo } : {}),
    },
  })
  return serializar(row)
}

export async function deleteProduto(id: string): Promise<void> {
  await prisma.produto.delete({ where: { id } })
}
