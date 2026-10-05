import { Prisma } from "@/lib/generated/prisma/client"
import { COLUNAS_SECRETAS, SECOES_BACKUP } from "@/lib/backup/secoes"

/**
 * Descrição dos models que entram no backup, lida do próprio schema do Prisma
 * (`Prisma.dmmf`). A restauração usa isto para converter tipos, achar chaves
 * estrangeiras e decidir a ordem de gravação — sem uma lista paralela que
 * ficaria desatualizada a cada migration.
 *
 * Só servidor (importa o cliente do Prisma).
 */

export interface CampoModelo {
  nome: string
  /** `String`, `Int`, `Boolean`, `DateTime`, `Json`, `Float` ou o nome do enum. */
  tipo: string
  ehEnum: boolean
  lista: boolean
  obrigatorio: boolean
  /** Tem valor padrão ou é preenchido pelo Prisma (`@updatedAt`): pode faltar no arquivo. */
  temPadrao: boolean
  autoincrement: boolean
  valoresEnum: ReadonlySet<string> | null
}

export interface FkModelo {
  campo: string
  /** Model apontado. */
  alvo: string
  /** Campo do model apontado (normalmente `id`). */
  alvoCampo: string
  obrigatorio: boolean
}

export interface ModeloRestauravel {
  nome: string
  /** Nome do delegate no cliente: `prisma.<delegate>`. */
  delegate: string
  /** Chave da seção do backup a que a tabela pertence. */
  secao: string
  pk: string[]
  campos: ReadonlyMap<string, CampoModelo>
  fks: FkModelo[]
  secretas: ReadonlySet<string>
  /** Campos que uma atualização pode mudar (tudo, menos a chave e as colunas secretas). */
  atualizaveis: string[]
}

// Forma mínima do DMMF que usamos (evita depender dos tipos internos do Prisma).
interface CampoDmmf {
  name: string
  kind: string
  type: string
  isList: boolean
  isRequired: boolean
  isId: boolean
  isUpdatedAt?: boolean
  hasDefaultValue: boolean
  default?: unknown
  relationFromFields?: readonly string[]
  relationToFields?: readonly string[]
}
interface ModeloDmmf {
  name: string
  fields: readonly CampoDmmf[]
  primaryKey?: { fields: readonly string[] } | null
}
interface EnumDmmf {
  name: string
  values: ReadonlyArray<{ name: string }>
}

let cache: Map<string, ModeloRestauravel> | null = null

function ehAutoincrement(valorPadrao: unknown): boolean {
  return Boolean(
    valorPadrao &&
      typeof valorPadrao === "object" &&
      (valorPadrao as { name?: unknown }).name === "autoincrement",
  )
}

/** Models restauráveis (os do catálogo de seções), por nome. */
export function carregarModelos(): ReadonlyMap<string, ModeloRestauravel> {
  if (cache) return cache

  const datamodel = Prisma.dmmf.datamodel as unknown as { models: readonly ModeloDmmf[]; enums: readonly EnumDmmf[] }
  const modelosDmmf = new Map(datamodel.models.map((m) => [m.name, m]))
  const enums = new Map(datamodel.enums.map((e) => [e.name, new Set(e.values.map((v) => v.name))]))

  const resultado = new Map<string, ModeloRestauravel>()
  for (const secao of SECOES_BACKUP) {
    for (const nome of secao.tabelas) {
      const modelo = modelosDmmf.get(nome)
      if (!modelo || resultado.has(nome)) continue

      const campos = new Map<string, CampoModelo>()
      for (const f of modelo.fields) {
        if (f.kind !== "scalar" && f.kind !== "enum") continue
        const ehEnum = f.kind === "enum"
        campos.set(f.name, {
          nome: f.name,
          tipo: f.type,
          ehEnum,
          lista: f.isList,
          obrigatorio: f.isRequired,
          // `workspaceId` é sempre preenchido pelo app (instância de quem restaura), nunca pelo arquivo.
          temPadrao: f.hasDefaultValue || Boolean(f.isUpdatedAt) || f.name === "workspaceId",
          autoincrement: ehAutoincrement(f.default),
          valoresEnum: ehEnum ? (enums.get(f.type) ?? new Set<string>()) : null,
        })
      }

      const pk = modelo.primaryKey?.fields?.length
        ? [...modelo.primaryKey.fields]
        : modelo.fields.filter((f) => f.isId).map((f) => f.name)

      const fks: FkModelo[] = []
      for (const f of modelo.fields) {
        if (f.kind !== "object" || f.relationFromFields?.length !== 1 || f.relationToFields?.length !== 1) continue
        const campo = f.relationFromFields[0]
        fks.push({
          campo,
          alvo: f.type,
          alvoCampo: f.relationToFields[0],
          obrigatorio: campos.get(campo)?.obrigatorio ?? true,
        })
      }

      const secretas = new Set(COLUNAS_SECRETAS[nome] ?? [])
      resultado.set(nome, {
        nome,
        delegate: nome.charAt(0).toLowerCase() + nome.slice(1),
        secao: secao.chave,
        pk,
        campos,
        fks,
        secretas,
        // Nunca se muda, por restauração: a instância dona do registro e o nível de um usuário
        // (senão um arquivo montado à mão promoveria alguém a root/admin).
        atualizaveis: [...campos.keys()].filter(
          (c) => !pk.includes(c) && !secretas.has(c) && c !== "workspaceId" && !(nome === "User" && c === "role"),
        ),
      })
    }
  }

  cache = resultado
  return resultado
}

/**
 * Ordem em que as tabelas devem ser gravadas: quem é apontado por uma chave
 * estrangeira vem antes de quem aponta (ex.: Campaign antes de Lead, User antes
 * de Atendente). Empates seguem a ordem do catálogo de seções.
 */
export function ordemDeRestauracao(): string[] {
  const modelos = carregarModelos()
  const pendentes = [...modelos.keys()]
  const dependencias = new Map(
    pendentes.map((nome) => [
      nome,
      new Set(modelos.get(nome)!.fks.map((fk) => fk.alvo).filter((alvo) => alvo !== nome && modelos.has(alvo))),
    ]),
  )

  const ordem: string[] = []
  const prontas = new Set<string>()
  while (pendentes.length) {
    const indice = pendentes.findIndex((nome) => [...dependencias.get(nome)!].every((d) => prontas.has(d)))
    // Ciclo (não existe hoje): segue a ordem do catálogo para não travar.
    const [nome] = pendentes.splice(indice === -1 ? 0 : indice, 1)
    ordem.push(nome)
    prontas.add(nome)
  }
  return ordem
}
