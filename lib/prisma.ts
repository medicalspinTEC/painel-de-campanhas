import type { PrismaClient } from "@/lib/generated/prisma/client"
import { getPrismaClient, isDatabaseConfigured, prismaGlobal } from "@/lib/prisma-base"
import { workspaceAtualId } from "@/lib/workspace-context"

export { isDatabaseConfigured, prismaGlobal }

/**
 * Checagem de conectividade barata (`SELECT 1`), usada pelo layout do painel
 * para decidir se mostra o aviso de setup do banco.
 */
export async function checkDatabaseConnection(): Promise<void> {
  await prismaGlobal.$queryRaw`SELECT 1`
}

/*
 * ---------------------------------------------------------------------------
 * Isolamento por instância (workspace)
 * ---------------------------------------------------------------------------
 * `prisma` é o cliente que o app inteiro usa. Ele intercepta TODA operação e:
 *  - leituras/alterações/exclusões: acrescenta o filtro da instância ao `where`;
 *  - criações: grava o `workspaceId` da instância (ignora o que vier nos dados);
 *  - referências (leadId, campanhaId, connect…): confere que o registro apontado
 *    é da mesma instância, para ninguém ligar um dado seu a um dado de outra.
 *
 * Tabelas com coluna `workspaceId` são filtradas direto. Tabelas filhas (sem a
 * coluna) são filtradas pelo pai (ex.: TimelineEvent → lead.workspaceId).
 * Um modelo novo SEM regra aqui faz a operação falhar (não vaza dados em silêncio).
 *
 * SQL cru (`$queryRaw`) NÃO passa por aqui: filtre à mão com `workspaceAtualId()`.
 */

/** Tabelas com a coluna `workspaceId`. */
const DIRETOS = new Set([
  "Lead",
  "Campaign",
  "Produto",
  "Marca",
  "Persona",
  "Regiao",
  "Settings",
  "Webhook",
  "AppLog",
  "InboundWebhookToken",
  "McpToken",
  "InboundEvent",
  "Instance",
  "NoCodeFlow",
  "BackupConfig",
  "BackupExecucao",
  "Departamento",
  "User",
])

/** Tabelas filhas: nome da relação que leva a uma tabela direta. */
const FILHOS: Record<string, string> = {
  ChatInternalNote: "lead",
  LeadCampaign: "lead",
  CampaignMessage: "campanha",
  ScheduledMessage: "lead",
  TimelineEvent: "lead",
  NoCodeExecution: "flow",
  Atendente: "user",
  AtendenteDepartamento: "departamento",
  LeadAtendimento: "lead",
  AtendimentoTransferencia: "lead",
}

/** Coluna de chave estrangeira → modelo apontado. */
const FK_MODELO: Record<string, string> = {
  leadId: "Lead",
  campanhaId: "Campaign",
  mensagemId: "CampaignMessage",
  flowId: "NoCodeFlow",
  departamentoId: "Departamento",
  atendenteId: "Atendente",
  userId: "User",
}

/** Campo de relação (to-one) → modelo apontado, para `connect`. */
const RELACAO_MODELO: Record<string, string> = {
  lead: "Lead",
  campanha: "Campaign",
  mensagem: "CampaignMessage",
  flow: "NoCodeFlow",
  departamento: "Departamento",
  atendente: "Atendente",
  user: "User",
}

/** Campos de relação (inclusive listas): só neles se procura escrita aninhada. Json fica de fora de propósito. */
const CAMPOS_RELACIONAIS = new Set([
  ...Object.keys(RELACAO_MODELO),
  "campanhas",
  "leads",
  "leadCampaigns",
  "mensagens",
  "eventos",
  "mensagensAgendadas",
  "notasInternas",
  "atendimento",
  "transferencias",
  "atendentes",
  "atendimentos",
  "departamentos",
  "execucoes",
])

type Obj = Record<string, unknown>

const ehObjeto = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date)
const emLista = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v])

function filtroDe(modelo: string, workspaceId: string): Obj {
  if (DIRETOS.has(modelo)) return { workspaceId }
  const relacao = FILHOS[modelo]
  if (relacao) return { [relacao]: { workspaceId } }
  throw new Error(`Modelo "${modelo}" sem regra de isolamento por instância (lib/prisma.ts).`)
}

function comFiltro(where: unknown, filtro: Obj): Obj {
  return ehObjeto(where) ? { AND: [where, filtro] } : filtro
}

/** `where` de chave única: mantém os campos únicos e soma o filtro via AND. */
function comFiltroUnico(where: unknown, filtro: Obj): Obj {
  const base = ehObjeto(where) ? where : {}
  return { ...base, AND: [...emLista(base.AND as Obj | Obj[] | undefined), filtro] }
}

// ---- Referências cruzadas -------------------------------------------------

type Referencias = Map<string, Set<string>>

function anotar(refs: Referencias, modelo: string, id: unknown) {
  if (typeof id !== "string") return
  const ids = refs.get(modelo) ?? new Set<string>()
  ids.add(id)
  refs.set(modelo, ids)
}

/** Procura, nos dados de uma escrita, ids que apontam para outros registros. */
function coletarDados(dados: unknown, refs: Referencias): void {
  for (const item of emLista(dados as Obj | Obj[])) {
    if (!ehObjeto(item)) continue
    for (const [chave, valor] of Object.entries(item)) {
      const alvo = FK_MODELO[chave]
      if (alvo) {
        if (typeof valor === "string") anotar(refs, alvo, valor)
        else if (ehObjeto(valor) && typeof valor.set === "string") anotar(refs, alvo, valor.set)
      } else if (CAMPOS_RELACIONAIS.has(chave) && ehObjeto(valor)) {
        coletarOperacoes(chave, valor, refs)
      }
    }
  }
}

function coletarOperacoes(campo: string, ops: Obj, refs: Referencias): void {
  for (const [op, valor] of Object.entries(ops)) {
    switch (op) {
      case "connect": {
        const alvo = RELACAO_MODELO[campo]
        if (!alvo) throw new Error(`connect em "${campo}" não é suportado pelo isolamento por instância.`)
        for (const ref of emLista(valor as Obj | Obj[])) anotar(refs, alvo, ehObjeto(ref) ? ref.id : undefined)
        break
      }
      case "create":
        coletarDados(valor, refs)
        break
      case "update":
        for (const item of emLista(valor as Obj | Obj[])) coletarDados(ehObjeto(item) && "data" in item ? item.data : item, refs)
        break
      case "createMany":
        if (ehObjeto(valor)) coletarDados(valor.data, refs)
        break
      case "upsert":
      case "connectOrCreate":
        for (const item of emLista(valor as Obj | Obj[])) {
          if (!ehObjeto(item)) continue
          coletarDados(item.create, refs)
          coletarDados(item.update, refs)
        }
        break
      default:
        break // disconnect, delete, set… não criam vínculo novo
    }
  }
}

const nomeDoDelegate = (modelo: string) => modelo.charAt(0).toLowerCase() + modelo.slice(1)

/** Garante que todo registro referenciado pertence à instância da operação. */
async function validarReferencias(dados: unknown, workspaceId: string): Promise<void> {
  const refs: Referencias = new Map()
  coletarDados(dados, refs)
  for (const [modelo, ids] of refs) {
    const delegate = (prismaGlobal as unknown as Record<string, { count: (a: unknown) => Promise<number> }>)[nomeDoDelegate(modelo)]
    const achados = await delegate.count({ where: { id: { in: [...ids] }, ...filtroDe(modelo, workspaceId) } })
    if (achados !== ids.size) throw new Error("Operação bloqueada: referência a um registro de outra instância.")
  }
}

function semWorkspace(dados: unknown): unknown {
  if (Array.isArray(dados)) return dados.map(semWorkspace)
  if (!ehObjeto(dados)) return dados
  const { workspaceId: _ignorado, ...resto } = dados
  return resto
}

function criandoEm(modelo: string, dados: unknown, workspaceId: string): unknown {
  if (!DIRETOS.has(modelo)) return dados
  const marcar = (d: unknown) => ({ ...(semWorkspace(d) as Obj), workspaceId })
  return Array.isArray(dados) ? dados.map(marcar) : marcar(dados)
}

function criarClienteEscopado(base: PrismaClient): PrismaClient {
  return base.$extends({
    name: "isolamento-por-instancia",
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          const workspaceId = await workspaceAtualId()
          const filtro = filtroDe(model, workspaceId)
          const a: Obj = ehObjeto(args) ? { ...args } : {}

          switch (operation) {
            case "findFirst":
            case "findFirstOrThrow":
            case "findMany":
            case "count":
            case "aggregate":
            case "groupBy":
            case "deleteMany":
              a.where = comFiltro(a.where, filtro)
              break

            case "updateMany":
            case "updateManyAndReturn":
              await validarReferencias(a.data, workspaceId)
              a.data = semWorkspace(a.data)
              a.where = comFiltro(a.where, filtro)
              break

            case "findUnique":
            case "findUniqueOrThrow":
            case "delete":
              a.where = comFiltroUnico(a.where, filtro)
              break

            case "update":
              await validarReferencias(a.data, workspaceId)
              a.data = semWorkspace(a.data)
              a.where = comFiltroUnico(a.where, filtro)
              break

            case "create":
              await validarReferencias(a.data, workspaceId)
              a.data = criandoEm(model, a.data, workspaceId)
              break

            case "createMany":
            case "createManyAndReturn":
              await validarReferencias(a.data, workspaceId)
              a.data = criandoEm(model, a.data, workspaceId)
              break

            case "upsert":
              await validarReferencias(a.create, workspaceId)
              await validarReferencias(a.update, workspaceId)
              a.where = comFiltroUnico(a.where, filtro)
              a.create = criandoEm(model, a.create, workspaceId)
              a.update = semWorkspace(a.update)
              break

            default:
              throw new Error(`Operação "${operation}" não suportada pelo isolamento por instância.`)
          }
          return query(a)
        },
      },
    },
  }) as unknown as PrismaClient
}

declare global {
  // eslint-disable-next-line no-var
  var __prismaEscopado: { base: PrismaClient; escopado: PrismaClient } | undefined
}

function getClienteEscopado(): PrismaClient {
  const base = getPrismaClient()
  const cache = globalThis.__prismaEscopado
  if (cache && cache.base === base) return cache.escopado
  const escopado = criarClienteEscopado(base)
  globalThis.__prismaEscopado = { base, escopado }
  return escopado
}

/**
 * Cliente do app: sempre filtrado pela instância da operação (ver o topo deste
 * arquivo). Resolvido sob demanda, como `prismaGlobal`.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_alvo, propriedade) {
    const cliente = getClienteEscopado()
    const valor = Reflect.get(cliente, propriedade, cliente)
    return typeof valor === "function" ? valor.bind(cliente) : valor
  },
})
