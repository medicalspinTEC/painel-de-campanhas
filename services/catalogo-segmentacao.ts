import { prisma } from "@/lib/prisma"

/**
 * Fábrica de serviços para os catálogos de segmentação (produtos, marcas,
 * personas e regiões). Todos compartilham a mesma estrutura: `nome` é a chave
 * de negócio (os leads guardam o valor como texto) e `ativo` controla se o
 * item aparece como opção em novos leads. Esta fábrica evita repetir a mesma
 * lógica de CRUD para cada dimensão.
 */

export interface ItemCatalogo {
  id: string
  nome: string
  descricao: string | null
  ativo: boolean
  idImportacao: string | null
  criadoEm: string
  atualizadoEm: string
}

export interface ItemCatalogoInput {
  nome: string
  descricao?: string | null
  ativo?: boolean
  idImportacao?: string | null
}

type ItemRow = {
  id: string
  nome: string
  descricao: string | null
  ativo: boolean
  idImportacao: string | null
  criadoEm: Date
  atualizadoEm: Date
}

/** Erro de nome duplicado, tratado na action para uma mensagem amigável. */
export class ItemCatalogoDuplicadoError extends Error {
  constructor(rotulo: string) {
    super(`Já existe ${rotulo} com esse nome.`)
    this.name = "ItemCatalogoDuplicadoError"
  }
}

/** Erro de ID de importação duplicado, tratado na action. */
export class ItemCatalogoIdImportacaoDuplicadoError extends Error {
  constructor(rotulo: string) {
    super(`Já existe ${rotulo} com esse ID de importação.`)
    this.name = "ItemCatalogoIdImportacaoDuplicadoError"
  }
}

/**
 * O Prisma devolve `Date`; as páginas e componentes trabalham com ISO string
 * (serializável entre Server e Client Components).
 */
function serializar(row: ItemRow): ItemCatalogo {
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

/**
 * Cada delegate do Prisma (`prisma.marca`, `prisma.persona`, ...) tem a mesma
 * forma. Tipamos apenas os métodos usados aqui para reaproveitar a fábrica sem
 * depender do tipo concreto de cada modelo.
 */
interface CatalogoDelegate {
  findMany(args?: unknown): Promise<ItemRow[]>
  findUnique(args: unknown): Promise<{ id: string } | ItemRow | null>
  findFirst(args: unknown): Promise<{ id: string } | ItemRow | null>
  create(args: unknown): Promise<ItemRow>
  update(args: unknown): Promise<ItemRow>
  upsert(args: unknown): Promise<ItemRow>
  delete(args: unknown): Promise<unknown>
}

export interface ServicoCatalogo {
  listar(): Promise<ItemCatalogo[]>
  listarNomesAtivos(): Promise<string[]>
  criar(input: ItemCatalogoInput): Promise<ItemCatalogo>
  atualizar(id: string, input: ItemCatalogoInput): Promise<ItemCatalogo | null>
  excluir(id: string): Promise<void>
  /**
   * Garante que exista um item ativo com este nome, cadastrando-o quando ainda
   * não existir. Usado pelo cadastro automático das dimensões de segmentação
   * quando um lead chega com um valor que não está no catálogo. É idempotente:
   * não gera erro nem duplica se o nome já existir.
   */
  garantir(nome: string): Promise<void>
  /**
   * Mapa de `idImportacao` normalizado (minúsculo) → nome. Usado na importação
   * de leads para resolver o valor da planilha por ID em vez do nome exato.
   */
  mapaPorIdImportacao(): Promise<Map<string, string>>
}

/** Cria um serviço de catálogo apontando para um delegate específico do Prisma. */
export function criarServicoCatalogo(
  delegate: () => CatalogoDelegate,
  /** Rótulo indefinido usado nas mensagens de erro (ex.: "uma marca"). */
  rotulo: string,
): ServicoCatalogo {
  async function listar(): Promise<ItemCatalogo[]> {
    const rows = (await delegate().findMany({ orderBy: { nome: "asc" } })) as ItemRow[]
    return rows.map(serializar)
  }

  async function listarNomesAtivos(): Promise<string[]> {
    const rows = (await delegate().findMany({
      where: { ativo: true },
      orderBy: { nome: "asc" },
      select: { nome: true },
    })) as Array<{ nome: string }>
    return rows.map((r) => r.nome)
  }

  async function criar(input: ItemCatalogoInput): Promise<ItemCatalogo> {
    const existente = await delegate().findUnique({ where: { nome: input.nome }, select: { id: true } })
    if (existente) throw new ItemCatalogoDuplicadoError(rotulo)

    const idImportacao = input.idImportacao?.trim() || null
    if (idImportacao) {
      const colisaoId = await delegate().findUnique({ where: { idImportacao }, select: { id: true } })
      if (colisaoId) throw new ItemCatalogoIdImportacaoDuplicadoError(rotulo)
    }

    const row = (await delegate().create({
      data: {
        nome: input.nome,
        descricao: input.descricao?.trim() || null,
        ativo: input.ativo ?? true,
        idImportacao,
      },
    })) as ItemRow
    return serializar(row)
  }

  async function atualizar(id: string, input: ItemCatalogoInput): Promise<ItemCatalogo | null> {
    const atual = await delegate().findUnique({ where: { id }, select: { id: true } })
    if (!atual) return null

    // Impede colisão de nome com outro item do mesmo catálogo.
    const colisao = await delegate().findFirst({
      where: { nome: input.nome, id: { not: id } },
      select: { id: true },
    })
    if (colisao) throw new ItemCatalogoDuplicadoError(rotulo)

    const idImportacao = input.idImportacao?.trim() || null
    if (idImportacao) {
      const colisaoId = await delegate().findFirst({
        where: { idImportacao, id: { not: id } },
        select: { id: true },
      })
      if (colisaoId) throw new ItemCatalogoIdImportacaoDuplicadoError(rotulo)
    }

    const row = (await delegate().update({
      where: { id },
      data: {
        nome: input.nome,
        descricao: input.descricao?.trim() || null,
        ...(input.ativo !== undefined ? { ativo: input.ativo } : {}),
        ...(input.idImportacao !== undefined ? { idImportacao } : {}),
      },
    })) as ItemRow
    return serializar(row)
  }

  async function excluir(id: string): Promise<void> {
    await delegate().delete({ where: { id } })
  }

  async function garantir(nome: string): Promise<void> {
    const limpo = nome.trim()
    if (!limpo) return
    // `nome` é @unique no schema, então o upsert é idempotente: cria quando o
    // valor ainda não existe e não faz nada quando já está cadastrado.
    await delegate().upsert({
      where: { nome: limpo },
      create: { nome: limpo, ativo: true },
      update: {},
    })
  }

  async function mapaPorIdImportacao(): Promise<Map<string, string>> {
    const rows = (await delegate().findMany({
      where: { idImportacao: { not: null } },
      select: { nome: true, idImportacao: true },
    })) as Array<{ nome: string; idImportacao: string | null }>
    const mapa = new Map<string, string>()
    for (const r of rows) {
      if (r.idImportacao) mapa.set(r.idImportacao.trim().toLowerCase(), r.nome)
    }
    return mapa
  }

  return { listar, listarNomesAtivos, criar, atualizar, excluir, garantir, mapaPorIdImportacao }
}

/** Delegates de cada catálogo. Resolvidos sob demanda (o Prisma é um Proxy). */
export const servicoMarcas = criarServicoCatalogo(() => prisma.marca as unknown as CatalogoDelegate, "uma marca")
export const servicoPersonas = criarServicoCatalogo(
  () => prisma.persona as unknown as CatalogoDelegate,
  "uma persona",
)
export const servicoRegioes = criarServicoCatalogo(() => prisma.regiao as unknown as CatalogoDelegate, "uma região")
