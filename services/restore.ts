import { randomBytes } from "node:crypto"
import { createReadStream } from "node:fs"
import { appendFile, mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"

import {
  LIMITE_ARQUIVO_BYTES,
  totalIgnorados,
  validarCabecalho,
  type CabecalhoBackup,
  type EventoRestauracao,
  type ModoRestauracao,
  type ResultadoRestauracao,
  type ResumoTabelaRestauracao,
} from "@/lib/backup/formato"
import { ArquivoInvalidoError, lerBackupEmStream } from "@/lib/backup/leitor-json"
import {
  carregarModelos,
  ordemDeRestauracao,
  type CampoModelo,
  type FkModelo,
  type ModeloRestauravel,
} from "@/lib/backup/modelos"
import { normalizarSecoes, SECOES_POR_CHAVE } from "@/lib/backup/secoes"
import { Prisma, type PrismaClient } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { recordAppLog } from "@/services/app-logs"

/**
 * Restauração a partir do arquivo .json do backup (o gerado por "Baixar backup").
 *
 * Como funciona:
 * 1. `prepararRestauracao` recebe o arquivo em fluxo (sem montá-lo na memória),
 *    valida o cabeçalho e guarda as linhas das seções escolhidas em arquivos
 *    temporários, uma tabela por arquivo. Isso é necessário porque no arquivo as
 *    tabelas vêm na ordem das seções (Lead antes de Campaign), mas a gravação
 *    precisa seguir as dependências (Campaign antes de Lead).
 * 2. `executar` grava (ou só analisa, com `simular`) tabela por tabela na ordem
 *    de dependência, em lotes. Cada lote converte os tipos, confere as chaves
 *    estrangeiras, separa o que já existe e grava o que falta.
 *
 * Garantias:
 * - Nada é apagado. Registros que só existem no banco ficam como estão.
 * - Idempotente: rodar de novo o mesmo arquivo não duplica nada.
 * - Segredos nunca entram (ver `COLUNAS_SECRETAS`), mesmo num arquivo adulterado.
 * - Chaves estrangeiras são conferidas antes de gravar: linha que depende de um
 *   registro inexistente é ignorada e contada, nunca derruba o lote.
 * - O usuário que está restaurando nunca tem a própria conta alterada.
 */

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface OpcoesRestauracao {
  /** Chaves de seção (ver `lib/backup/secoes.ts`). */
  secoes: string[]
  modo: ModoRestauracao
  /** Só analisa: lê tudo, confere e conta, sem gravar nada. */
  simular: boolean
  /** Quem está restaurando: a conta dele nunca é alterada. */
  usuarioId: string
  usuarioNome: string
}

export interface RestauracaoPreparada {
  cabecalho: CabecalhoBackup
  executar: (aoEvento: (evento: EventoRestauracao) => void) => Promise<ResultadoRestauracao>
  /** Libera o que foi reservado, caso `executar` não vá ser chamado. Pode ser chamado mais de uma vez. */
  descartar: () => Promise<void>
}

/** Erro com mensagem própria para o usuário (arquivo inválido, restauração em andamento etc.). */
export class RestauracaoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RestauracaoError"
  }
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const PREFIXO_TEMP = "painel-restore-"
const TEMP_MAXIMO_MS = 24 * 60 * 60 * 1000
const TRAVA_MAXIMA_MS = 2 * 60 * 60 * 1000
const TAMANHO_LOTE_PADRAO = 500
const TAMANHO_LOTE: Record<string, number> = {
  TimelineEvent: 1000,
  AppLog: 1000,
  InboundEvent: 200,
  NoCodeExecution: 100,
  NoCodeFlow: 50,
  Settings: 10,
}
const FLUSH_SPOOL_BYTES = 1024 * 1024
const ATUALIZACOES_POR_TRANSACAO = 50
const MAX_AMOSTRAS = 5
const MAX_FALHAS_SEGUIDAS = 5
const INTERVALO_PROGRESSO_MS = 400
const INT_MIN = -2147483648
const INT_MAX = 2147483647

// ---------------------------------------------------------------------------
// Trava: uma restauração por vez (por processo)
// ---------------------------------------------------------------------------

const CHAVE_TRAVA = Symbol.for("painel.restauracao.travada")

function adquirirTrava(): boolean {
  const g = globalThis as unknown as Record<symbol, number | undefined>
  const desde = g[CHAVE_TRAVA]
  if (desde && Date.now() - desde < TRAVA_MAXIMA_MS) return false
  g[CHAVE_TRAVA] = Date.now()
  return true
}

function soltarTrava(): void {
  delete (globalThis as unknown as Record<symbol, number | undefined>)[CHAVE_TRAVA]
}

// ---------------------------------------------------------------------------
// Arquivos temporários
// ---------------------------------------------------------------------------

/** Guarda as linhas de cada tabela em disco (NDJSON), com escrita em blocos. */
class Spool {
  private readonly buffers = new Map<string, string[]>()
  private readonly tamanhos = new Map<string, number>()
  private readonly contagens = new Map<string, number>()

  constructor(private readonly pasta: string) {}

  caminho(tabela: string): string {
    return join(this.pasta, `${tabela}.ndjson`)
  }

  linhas(tabela: string): number {
    return this.contagens.get(tabela) ?? 0
  }

  get total(): number {
    let soma = 0
    for (const n of this.contagens.values()) soma += n
    return soma
  }

  async escrever(tabela: string, linhaJson: string): Promise<void> {
    // Quebra de linha crua só existe fora de strings JSON (dentro, ela viria escapada): trocar por espaço é seguro.
    const linha = (/[\r\n]/.test(linhaJson) ? linhaJson.replace(/\r\n|\r|\n/g, " ") : linhaJson) + "\n"
    const buffer = this.buffers.get(tabela) ?? []
    buffer.push(linha)
    this.buffers.set(tabela, buffer)
    this.contagens.set(tabela, (this.contagens.get(tabela) ?? 0) + 1)
    const bytes = (this.tamanhos.get(tabela) ?? 0) + linha.length
    this.tamanhos.set(tabela, bytes)
    if (bytes >= FLUSH_SPOOL_BYTES) await this.descarregar(tabela)
  }

  async fechar(): Promise<void> {
    for (const tabela of [...this.buffers.keys()]) await this.descarregar(tabela)
  }

  private async descarregar(tabela: string): Promise<void> {
    const buffer = this.buffers.get(tabela)
    if (!buffer?.length) return
    this.buffers.set(tabela, [])
    this.tamanhos.set(tabela, 0)
    await appendFile(this.caminho(tabela), buffer.join(""), "utf8")
  }
}

async function* lerLotes(caminho: string, tamanho: number): AsyncGenerator<string[]> {
  const leitor = createInterface({ input: createReadStream(caminho, { encoding: "utf8" }), crlfDelay: Infinity })
  let lote: string[] = []
  try {
    for await (const linha of leitor) {
      if (!linha) continue
      lote.push(linha)
      if (lote.length >= tamanho) {
        yield lote
        lote = []
      }
    }
    if (lote.length) yield lote
  } finally {
    leitor.close()
  }
}

/** Apaga restos de restaurações que foram interrompidas (processo caiu no meio). */
async function limparTemporariosAntigos(): Promise<void> {
  try {
    const base = tmpdir()
    for (const nome of await readdir(base)) {
      if (!nome.startsWith(PREFIXO_TEMP)) continue
      const caminho = join(base, nome)
      const info = await stat(caminho).catch(() => null)
      if (info && Date.now() - info.mtimeMs > TEMP_MAXIMO_MS) await rm(caminho, { recursive: true, force: true })
    }
  } catch {
    // Melhor esforço.
  }
}

/** Lê o corpo da requisição pedaço a pedaço, com teto de tamanho. */
async function* pedacos(fonte: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const leitor = fonte.getReader()
  let total = 0
  let terminou = false
  try {
    for (;;) {
      const { done, value } = await leitor.read()
      if (done) {
        terminou = true
        return
      }
      total += value.byteLength
      if (total > LIMITE_ARQUIVO_BYTES) {
        throw new RestauracaoError(
          `O arquivo passa de ${Math.round(LIMITE_ARQUIVO_BYTES / (1024 * 1024))} MB, que é o limite aceito.`,
        )
      }
      yield value
    }
  } finally {
    if (!terminou) await leitor.cancel().catch(() => undefined)
    leitor.releaseLock()
  }
}

// ---------------------------------------------------------------------------
// Acesso dinâmico aos delegates do Prisma
// ---------------------------------------------------------------------------

interface DelegateDinamico {
  findMany: (args: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>
  createMany: (args: { data: Array<Record<string, unknown>>; skipDuplicates?: boolean }) => Promise<{ count: number }>
  update: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<unknown>
}

function delegateDe(db: PrismaClient, modelo: Pick<ModeloRestauravel, "delegate">): DelegateDinamico {
  return (db as unknown as Record<string, DelegateDinamico>)[modelo.delegate]
}

// ---------------------------------------------------------------------------
// Contexto e utilitários da aplicação
// ---------------------------------------------------------------------------

interface Item {
  /** Valores prontos para o Prisma. */
  dados: Record<string, unknown>
  /** Chave primária em texto (para comparar). */
  chave: string
  descartado?: boolean
  /** Usuário recriado sem senha: recebe uma senha que ninguém consegue usar. */
  senhaProvisoria?: boolean
}

interface Contexto {
  db: PrismaClient
  opcoes: OpcoesRestauracao
  modelos: ReadonlyMap<string, ModeloRestauravel>
  /** Tabela -> (id no backup -> id no banco). Hoje só `User`, quando o login já existe com outro id. */
  remap: Map<string, Map<string, string>>
  /** Só na simulação: ids que seriam criados, para as tabelas que outras tabelas apontam. */
  idsNoArquivo: Map<string, Set<string>>
  colunasIgnoradas: Map<string, Set<string>>
  usuariosSemSenha: number
  falhasSeguidas: number
  avisos: string[]
}

function novoResumo(modelo: ModeloRestauravel, noArquivo: number): ResumoTabelaRestauracao {
  return {
    tabela: modelo.nome,
    secao: modelo.secao,
    noArquivo,
    novos: 0,
    existentes: 0,
    atualizados: 0,
    semReferencia: 0,
    conflitos: 0,
    invalidos: 0,
    vinculosRemovidos: 0,
    mapeados: 0,
    erros: 0,
    amostras: [],
  }
}

function amostra(resumo: ResumoTabelaRestauracao, texto: string): void {
  if (resumo.amostras.length < MAX_AMOSTRAS && !resumo.amostras.includes(texto)) resumo.amostras.push(texto)
}

function mensagemErro(erro: unknown): string {
  const codigo = erro && typeof erro === "object" && "code" in erro ? String((erro as { code: unknown }).code) : ""
  const base = erro instanceof Error ? erro.message : String(erro)
  const texto = base.replace(/\s+/g, " ").trim().slice(-300)
  if (codigo === "P2003") return `referência inexistente (${codigo}): ${texto}`
  if (codigo === "P2002") return `valor repetido em campo único (${codigo}): ${texto}`
  return codigo ? `${codigo}: ${texto}` : texto
}

function chaveDe(modelo: ModeloRestauravel, dados: Record<string, unknown>): string {
  return modelo.pk.map((campo) => String(dados[campo])).join("\u0000")
}

function* fatiar<T>(lista: T[], tamanho: number): Generator<T[]> {
  for (let i = 0; i < lista.length; i += tamanho) yield lista.slice(i, i + tamanho)
}

/** Senha que ninguém consegue usar: o formato não é `scrypt$…`, então `verificarSenha` sempre recusa. */
function senhaIndisponivel(): string {
  return `restauracao$sem-senha$${randomBytes(24).toString("hex")}`
}

// ---------------------------------------------------------------------------
// Conversão de tipos (JSON -> valores do Prisma)
// ---------------------------------------------------------------------------

type Convertido = { valor: unknown } | null

function converterEscalar(campo: CampoModelo, valor: unknown): Convertido {
  switch (campo.tipo) {
    case "String":
      return typeof valor === "string" ? { valor } : null
    case "Boolean":
      return typeof valor === "boolean" ? { valor } : null
    case "Int":
      return typeof valor === "number" && Number.isInteger(valor) && valor >= INT_MIN && valor <= INT_MAX ? { valor } : null
    case "Float":
      return typeof valor === "number" && Number.isFinite(valor) ? { valor } : null
    case "DateTime": {
      if (typeof valor !== "string") return null
      const data = new Date(valor)
      return Number.isNaN(data.getTime()) ? null : { valor: data }
    }
    case "Json":
      return { valor }
    default:
      if (campo.ehEnum) return typeof valor === "string" && campo.valoresEnum?.has(valor) ? { valor } : null
      return { valor }
  }
}

function converterCampo(campo: CampoModelo, valor: unknown): Convertido {
  if (!campo.lista) return converterEscalar(campo, valor)
  if (!Array.isArray(valor)) return null
  const itens: unknown[] = []
  for (const elemento of valor) {
    const convertido = converterEscalar(campo, elemento)
    if (!convertido) return null
    itens.push(convertido.valor)
  }
  return { valor: itens }
}

function descreverTipo(campo: CampoModelo): string {
  const base = campo.ehEnum ? `um de ${[...(campo.valoresEnum ?? [])].join("/")}` : campo.tipo
  return campo.lista ? `lista de ${base}` : base
}

/**
 * Converte uma linha do arquivo nos valores do Prisma. Colunas desconhecidas
 * (de outra versão do schema) são ignoradas; colunas que faltam usam o padrão
 * do banco; colunas secretas nunca são lidas.
 */
function converterLinha(
  modelo: ModeloRestauravel,
  bruta: unknown,
  ignoradas: Set<string>,
): { dados: Record<string, unknown> } | { motivo: string } {
  if (!bruta || typeof bruta !== "object" || Array.isArray(bruta)) return { motivo: "a linha não é um objeto" }
  const linha = bruta as Record<string, unknown>

  for (const chave of Object.keys(linha)) {
    if (!modelo.campos.has(chave) && !modelo.secretas.has(chave)) ignoradas.add(chave)
  }

  const dados: Record<string, unknown> = {}
  for (const campo of modelo.campos.values()) {
    if (modelo.secretas.has(campo.nome)) continue
    // A instância não vem do arquivo: o filtro de `prisma` grava a de quem está restaurando.
    if (campo.nome === "workspaceId") continue
    const valor = linha[campo.nome]

    if (valor === undefined || valor === null) {
      if (campo.obrigatorio) {
        if (campo.temPadrao) continue
        return { motivo: `o campo "${campo.nome}" é obrigatório e não veio no arquivo` }
      }
      if (valor === null) dados[campo.nome] = campo.tipo === "Json" ? Prisma.DbNull : null
      continue
    }

    const convertido = converterCampo(campo, valor)
    if (!convertido) return { motivo: `valor inválido em "${campo.nome}" (esperado ${descreverTipo(campo)})` }
    dados[campo.nome] = convertido.valor
  }

  for (const campo of modelo.pk) {
    const valor = dados[campo]
    if (valor === undefined || valor === null || valor === "") return { motivo: `a chave "${campo}" não veio no arquivo` }
  }
  return { dados }
}

// ---------------------------------------------------------------------------
// Passos de um lote
// ---------------------------------------------------------------------------

/** Usuário do backup cujo login já existe com outro id: reaproveita o do banco (e as referências são redirecionadas). */
async function prepararUsuarios(ctx: Contexto, modelo: ModeloRestauravel, itens: Item[], resumo: ResumoTabelaRestauracao) {
  const logins = [...new Set(itens.map((i) => i.dados.username).filter((v): v is string => typeof v === "string"))]
  if (!logins.length) return
  const existentes = await delegateDe(ctx.db, modelo).findMany({
    where: { username: { in: logins } },
    select: { id: true, username: true },
  })
  const idPorLogin = new Map(existentes.map((u) => [String(u.username), String(u.id)]))

  let mapa = ctx.remap.get(modelo.nome)
  if (!mapa) {
    mapa = new Map()
    ctx.remap.set(modelo.nome, mapa)
  }

  for (const item of itens) {
    const idNoBanco = idPorLogin.get(String(item.dados.username))
    if (idNoBanco && idNoBanco !== item.dados.id) {
      mapa.set(String(item.dados.id), idNoBanco)
      item.descartado = true
      resumo.mapeados++
      amostra(resumo, `login "${String(item.dados.username)}" já existe: o usuário atual foi mantido`)
      continue
    }
    // As senhas nunca entram no backup: quem for recriado fica sem senha utilizável até alguém definir uma.
    if (!idNoBanco) {
      item.dados.senhaHash = senhaIndisponivel()
      item.senhaProvisoria = true
      // Usuário recriado a partir de arquivo nasce sempre como padrão: root e admin só são criados
      // em Usuários (admin tem instância própria; promover alguém por um arquivo seria uma brecha).
      item.dados.role = "padrao"
    }
  }
}

async function referenciasExistentes(ctx: Contexto, fk: FkModelo, valores: string[]): Promise<Set<string>> {
  const alvo = ctx.modelos.get(fk.alvo)
  // Alvo fora do catálogo de backup: não dá para conferir aqui; o banco decide.
  if (!alvo) return new Set(valores)

  const doArquivo = ctx.idsNoArquivo.get(fk.alvo)
  const achados = new Set<string>()
  const faltam: string[] = []
  for (const valor of valores) {
    if (doArquivo?.has(valor)) achados.add(valor)
    else faltam.push(valor)
  }
  if (faltam.length) {
    const linhas = await delegateDe(ctx.db, alvo).findMany({
      where: { [fk.alvoCampo]: { in: faltam } },
      select: { [fk.alvoCampo]: true },
    })
    for (const linha of linhas) achados.add(String(linha[fk.alvoCampo]))
  }
  return achados
}

/**
 * Confere as chaves estrangeiras: dependência obrigatória inexistente descarta a
 * linha; dependência opcional inexistente grava a linha sem o vínculo (o mesmo
 * que `onDelete: SetNull` faria).
 */
async function validarReferencias(ctx: Contexto, modelo: ModeloRestauravel, itens: Item[], resumo: ResumoTabelaRestauracao) {
  for (const fk of modelo.fks) {
    const valores = new Set<string>()
    for (const item of itens) {
      const valor = item.dados[fk.campo]
      if (!item.descartado && typeof valor === "string") valores.add(valor)
    }
    if (!valores.size) continue

    const existem = await referenciasExistentes(ctx, fk, [...valores])
    for (const item of itens) {
      const valor = item.dados[fk.campo]
      if (item.descartado || typeof valor !== "string" || existem.has(valor)) continue
      if (fk.obrigatorio) {
        item.descartado = true
        resumo.semReferencia++
        amostra(resumo, `${fk.campo} "${valor}" não existe em ${fk.alvo}`)
      } else {
        item.dados[fk.campo] = null
        resumo.vinculosRemovidos++
      }
    }
  }
  return itens.filter((i) => !i.descartado)
}

async function chavesExistentes(ctx: Contexto, modelo: ModeloRestauravel, itens: Item[]): Promise<Set<string>> {
  const delegate = delegateDe(ctx.db, modelo)
  const primeiro = modelo.pk[0]
  const valores = [...new Set(itens.map((i) => i.dados[primeiro]))]
  // Chave composta: busca pelo primeiro campo e compara a chave inteira.
  const select = Object.fromEntries(modelo.pk.map((campo) => [campo, true]))
  const linhas = await delegate.findMany({ where: { [primeiro]: { in: valores } }, select })
  return new Set(linhas.map((linha) => chaveDe(modelo, linha)))
}

async function inserir(ctx: Contexto, modelo: ModeloRestauravel, itens: Item[], resumo: ResumoTabelaRestauracao) {
  if (!itens.length) return { inseridos: 0, erros: 0 }
  const delegate = delegateDe(ctx.db, modelo)
  try {
    const { count } = await delegate.createMany({ data: itens.map((i) => i.dados), skipDuplicates: true })
    return { inseridos: count, erros: 0 }
  } catch {
    // Alguma linha não passou no banco: grava uma a uma para isolar a que falhou sem perder as outras.
    let inseridos = 0
    let erros = 0
    for (const item of itens) {
      try {
        const { count } = await delegate.createMany({ data: [item.dados], skipDuplicates: true })
        inseridos += count
      } catch (erro) {
        erros++
        resumo.erros++
        amostra(resumo, mensagemErro(erro))
      }
    }
    return { inseridos, erros }
  }
}

function dadosDeAtualizacao(modelo: ModeloRestauravel, item: Item): Record<string, unknown> {
  const dados: Record<string, unknown> = {}
  for (const campo of modelo.atualizaveis) if (campo in item.dados) dados[campo] = item.dados[campo]
  return dados
}

async function atualizar(ctx: Contexto, modelo: ModeloRestauravel, itens: Item[], resumo: ResumoTabelaRestauracao) {
  const delegate = delegateDe(ctx.db, modelo)
  const campoChave = modelo.pk[0]
  let atualizados = 0
  for (const grupo of fatiar(itens, ATUALIZACOES_POR_TRANSACAO)) {
    const operacoes = grupo.map((item) => ({
      where: { [campoChave]: item.dados[campoChave] },
      data: dadosDeAtualizacao(modelo, item),
    }))
    try {
      await ctx.db.$transaction(operacoes.map((args) => delegate.update(args)) as never)
      atualizados += grupo.length
    } catch {
      for (const args of operacoes) {
        try {
          await delegate.update(args)
          atualizados++
        } catch (erro) {
          resumo.erros++
          amostra(resumo, mensagemErro(erro))
        }
      }
    }
  }
  return atualizados
}

async function processarLote(ctx: Contexto, modelo: ModeloRestauravel, linhas: string[], resumo: ResumoTabelaRestauracao) {
  const { opcoes } = ctx
  const ignoradas = ctx.colunasIgnoradas.get(modelo.nome) ?? new Set<string>()
  ctx.colunasIgnoradas.set(modelo.nome, ignoradas)

  // 1. Converter os tipos.
  let itens: Item[] = []
  const vistos = new Set<string>()
  for (const texto of linhas) {
    let bruta: unknown
    try {
      bruta = JSON.parse(texto)
    } catch {
      resumo.invalidos++
      amostra(resumo, "linha com JSON malformado")
      continue
    }
    const convertida = converterLinha(modelo, bruta, ignoradas)
    if ("motivo" in convertida) {
      resumo.invalidos++
      amostra(resumo, convertida.motivo)
      continue
    }
    const chave = chaveDe(modelo, convertida.dados)
    if (vistos.has(chave)) {
      resumo.conflitos++
      amostra(resumo, "registro repetido no arquivo (mesmo id)")
      continue
    }
    vistos.add(chave)
    itens.push({ dados: convertida.dados, chave })
  }
  if (!itens.length) return

  // 2. Usuários: reaproveitar quem já existe pelo login.
  if (modelo.nome === "User") {
    await prepararUsuarios(ctx, modelo, itens, resumo)
    itens = itens.filter((i) => !i.descartado)
  }

  // 3. Redirecionar referências de usuários reaproveitados.
  for (const fk of modelo.fks) {
    const mapa = ctx.remap.get(fk.alvo)
    if (!mapa?.size) continue
    for (const item of itens) {
      const valor = item.dados[fk.campo]
      const novo = typeof valor === "string" ? mapa.get(valor) : undefined
      if (novo) item.dados[fk.campo] = novo
    }
  }

  // 4. Chaves estrangeiras.
  itens = await validarReferencias(ctx, modelo, itens, resumo)
  if (!itens.length) return

  // 5. O que já existe.
  const existentes = await chavesExistentes(ctx, modelo, itens)
  const novos = itens.filter((i) => !existentes.has(i.chave))
  const jaExistem = itens.filter((i) => existentes.has(i.chave))
  resumo.existentes += jaExistem.length

  const doArquivo = ctx.idsNoArquivo.get(modelo.nome)
  if (doArquivo && modelo.pk.length === 1) for (const item of itens) doArquivo.add(String(item.dados[modelo.pk[0]]))

  // Só PK simples tem o que atualizar (a tabela de vínculos é só chave).
  const podeAtualizar = opcoes.modo === "sobrescrever" && modelo.atualizaveis.length > 0 && modelo.pk.length === 1
  let aAtualizar: Item[] = []
  if (podeAtualizar) {
    aAtualizar = jaExistem.filter((item) => {
      if (modelo.nome === "User" && item.dados.id === opcoes.usuarioId) {
        resumo.conflitos++
        amostra(resumo, "a sua própria conta não é alterada pela restauração")
        return false
      }
      return true
    })
  }

  if (opcoes.simular) {
    resumo.novos += novos.length
    resumo.atualizados += aAtualizar.length
    ctx.usuariosSemSenha += novos.filter((i) => i.senhaProvisoria).length
    return
  }

  // 6. Gravar.
  const { inseridos, erros } = await inserir(ctx, modelo, novos, resumo)
  resumo.novos += inseridos
  const duplicados = novos.length - inseridos - erros
  if (duplicados > 0) {
    resumo.conflitos += duplicados
    amostra(resumo, "já existe outro registro com o mesmo valor em um campo único (nome, login…)")
  }
  ctx.usuariosSemSenha += Math.min(inseridos, novos.filter((i) => i.senhaProvisoria).length)

  if (aAtualizar.length) resumo.atualizados += await atualizar(ctx, modelo, aAtualizar, resumo)
}

/**
 * Registros gravados com id explícito não avançam o contador do banco
 * (ex.: `Campaign.idImportacao`, que é sequencial). Sem isto, a próxima campanha
 * criada receberia um número que já existe. O contador só é aumentado, nunca reduzido.
 */
async function ajustarContadores(ctx: Contexto, modelo: ModeloRestauravel): Promise<void> {
  for (const campo of modelo.campos.values()) {
    if (!campo.autoincrement) continue
    if (!/^\w+$/.test(modelo.nome) || !/^\w+$/.test(campo.nome)) continue
    const tabela = `"${modelo.nome}"`
    const coluna = `"${campo.nome}"`
    try {
      await ctx.db.$executeRawUnsafe(`
        DO $$
        DECLARE seq text; maximo bigint; atual bigint;
        BEGIN
          seq := pg_get_serial_sequence('${tabela}', '${campo.nome}');
          IF seq IS NULL THEN RETURN; END IF;
          EXECUTE 'SELECT MAX(${coluna}) FROM ${tabela}' INTO maximo;
          IF maximo IS NULL THEN RETURN; END IF;
          EXECUTE format('SELECT last_value FROM %s', seq) INTO atual;
          IF maximo >= atual THEN PERFORM setval(seq, maximo); END IF;
        END $$;
      `)
    } catch (erro) {
      ctx.avisos.push(
        `Não consegui ajustar o contador de ${modelo.nome}.${campo.nome}. Confira se novos cadastros recebem um número inédito. (${mensagemErro(erro)})`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Avisos do resultado
// ---------------------------------------------------------------------------

function nomeDaSecao(chave: string): string {
  return SECOES_POR_CHAVE[chave]?.nome ?? chave
}

function montarAvisos(
  ctx: Contexto,
  resumos: ResumoTabelaRestauracao[],
  desconhecidas: ReadonlySet<string>,
  secoesSemDados: string[],
): string[] {
  const avisos = [...ctx.avisos]
  const verbo = ctx.opcoes.simular ? "seriam" : "foram"

  if (desconhecidas.size) {
    avisos.push(`Tabelas do arquivo que este painel não conhece foram ignoradas: ${[...desconhecidas].join(", ")}.`)
  }
  if (secoesSemDados.length) {
    avisos.push(`O arquivo não tem dados de: ${secoesSemDados.map(nomeDaSecao).join(", ")}.`)
  }

  for (const r of resumos) {
    const modelo = ctx.modelos.get(r.tabela)
    if (r.semReferencia > 0 && modelo) {
      const alvos = [
        ...new Set(modelo.fks.filter((fk) => fk.obrigatorio).map((fk) => nomeDaSecao(ctx.modelos.get(fk.alvo)?.secao ?? fk.alvo))),
      ]
      avisos.push(
        `${r.semReferencia} registro(s) de ${r.tabela} ${verbo} ignorados porque dependem de registros que não existem${
          alvos.length ? ` — restaure também: ${alvos.join(", ")}` : ""
        }.`,
      )
    }
    if (r.mapeados > 0) {
      avisos.push(
        `${r.mapeados} usuário(s) do backup já existem com o mesmo login e foram mantidos; o que dependia deles foi ligado aos usuários atuais.`,
      )
    }
    if (r.conflitos > 0) {
      avisos.push(`${r.conflitos} registro(s) de ${r.tabela} ${verbo} ignorados por conflito (valor repetido ou conta protegida).`)
    }
    if (r.invalidos > 0) avisos.push(`${r.invalidos} linha(s) de ${r.tabela} estavam malformadas e ${verbo} ignoradas.`)
    if (r.erros > 0) avisos.push(`${r.erros} registro(s) de ${r.tabela} não puderam ser gravados.`)
    if (r.vinculosRemovidos > 0) {
      avisos.push(`${r.vinculosRemovidos} vínculo(s) opcional(is) de ${r.tabela} ${verbo} gravados sem o vínculo, pois o registro apontado não existe.`)
    }
  }

  const colunas = [...ctx.colunasIgnoradas.entries()].filter(([, set]) => set.size)
  for (const [tabela, set] of colunas) {
    avisos.push(`Colunas de ${tabela} que não existem mais neste painel foram ignoradas: ${[...set].join(", ")}.`)
  }

  const gravou = (tabela: string) => {
    const r = resumos.find((x) => x.tabela === tabela)
    return Boolean(r && r.novos + r.atualizados > 0)
  }
  if (ctx.usuariosSemSenha > 0) {
    avisos.push(
      `${ctx.usuariosSemSenha} usuário(s) ${verbo} recriados SEM senha (as senhas nunca entram no backup). Defina uma nova senha para eles em Usuários.`,
    )
  }
  if (gravou("Webhook")) {
    avisos.push("Os webhooks de saída voltam sem o segredo de assinatura: informe o segredo de novo em Integrações.")
  }
  if (gravou("NoCodeFlow")) {
    avisos.push("Os fluxos No Code voltam sem o segredo do webhook de execuções: informe-o de novo, se usava.")
  }
  return avisos
}

// ---------------------------------------------------------------------------
// Entrada pública
// ---------------------------------------------------------------------------

/**
 * Recebe o arquivo, valida o cabeçalho e guarda as linhas das seções escolhidas
 * para a aplicação. Lança `RestauracaoError` se o arquivo não servir ou se já
 * houver uma restauração em andamento. Quem chama deve chamar `executar` ou
 * `descartar`.
 */
export async function prepararRestauracao(
  fonte: ReadableStream<Uint8Array>,
  opcoesBrutas: OpcoesRestauracao,
  db: PrismaClient = prisma,
): Promise<RestauracaoPreparada> {
  const secoes = normalizarSecoes(opcoesBrutas.secoes)
  if (!secoes.length) throw new RestauracaoError("Selecione ao menos uma seção para restaurar.")
  const opcoes: OpcoesRestauracao = { ...opcoesBrutas, secoes }

  if (!adquirirTrava()) throw new RestauracaoError("Já existe uma restauração em andamento. Aguarde ela terminar.")

  let pasta: string | null = null
  let liberado = false
  const liberar = async () => {
    if (liberado) return
    liberado = true
    if (pasta) await rm(pasta, { recursive: true, force: true }).catch(() => undefined)
    soltarTrava()
  }

  try {
    await limparTemporariosAntigos()
    pasta = await mkdtemp(join(tmpdir(), PREFIXO_TEMP))

    const modelos = carregarModelos()
    const escolhidas = new Set(secoes.flatMap((s) => SECOES_POR_CHAVE[s].tabelas).filter((t) => modelos.has(t)))
    const spool = new Spool(pasta)
    const desconhecidas = new Set<string>()
    let cabecalho: CabecalhoBackup | null = null

    await lerBackupEmStream(pedacos(fonte), {
      aoCabecalho: (bruto) => {
        const validado = validarCabecalho(bruto)
        if (!validado.ok) throw new RestauracaoError(validado.erro)
        cabecalho = validado.cabecalho
      },
      aoLinha: async (tabela, linha) => {
        if (!modelos.has(tabela)) {
          desconhecidas.add(tabela)
          return
        }
        if (escolhidas.has(tabela)) await spool.escrever(tabela, linha)
      },
    })
    await spool.fechar()

    const lido = cabecalho as CabecalhoBackup | null
    if (!lido) throw new RestauracaoError("Não consegui ler o cabeçalho do backup.")
    if (spool.total === 0) throw new RestauracaoError("O arquivo não tem registros nas seções escolhidas.")

    const secoesSemDados = secoes.filter((s) => !SECOES_POR_CHAVE[s].tabelas.some((t) => spool.linhas(t) > 0))

    const executar: RestauracaoPreparada["executar"] = async (aoEvento) => {
      const inicio = Date.now()
      const ordem = ordemDeRestauracao().filter((t) => spool.linhas(t) > 0)
      const alvosDeFk = new Set(ordem.flatMap((t) => modelos.get(t)!.fks.map((fk) => fk.alvo)))
      const ctx: Contexto = {
        db,
        opcoes,
        modelos,
        remap: new Map(),
        idsNoArquivo: new Map(opcoes.simular ? [...alvosDeFk].map((t) => [t, new Set<string>()] as const) : []),
        colunasIgnoradas: new Map(),
        usuariosSemSenha: 0,
        falhasSeguidas: 0,
        avisos: [],
      }
      const resumos: ResumoTabelaRestauracao[] = []

      try {
        const acao = opcoes.simular ? "Analisando" : "Restaurando"
        aoEvento({ tipo: "fase", mensagem: `${acao} ${spool.total.toLocaleString("pt-BR")} registros…` })
        if (!opcoes.simular) {
          await recordAppLog({
            nivel: "info",
            origem: "backup",
            mensagem: `Restauração iniciada por ${opcoes.usuarioNome} (modo: ${opcoes.modo}).`,
            detalhes: `Backup ${lido.id} gerado em ${lido.geradoEm}. Seções: ${secoes.join(", ")}.`,
          })
        }

        let ultimoEvento = 0
        for (const [indice, nome] of ordem.entries()) {
          const modelo = modelos.get(nome)!
          const resumo = novoResumo(modelo, spool.linhas(nome))
          resumos.push(resumo)

          let feitas = 0
          for await (const linhas of lerLotes(spool.caminho(nome), TAMANHO_LOTE[nome] ?? TAMANHO_LOTE_PADRAO)) {
            try {
              await processarLote(ctx, modelo, linhas, resumo)
              ctx.falhasSeguidas = 0
            } catch (erro) {
              resumo.erros += linhas.length
              amostra(resumo, mensagemErro(erro))
              if (++ctx.falhasSeguidas >= MAX_FALHAS_SEGUIDAS) {
                throw new RestauracaoError(
                  `A restauração foi interrompida em ${nome}: várias falhas seguidas ao acessar o banco (${mensagemErro(erro)}). O que já foi gravado foi mantido; rode de novo para continuar.`,
                )
              }
            }
            feitas += linhas.length
            const agora = Date.now()
            if (agora - ultimoEvento >= INTERVALO_PROGRESSO_MS) {
              ultimoEvento = agora
              aoEvento({ tipo: "progresso", tabela: nome, feitas, total: resumo.noArquivo, tabelasConcluidas: indice, totalTabelas: ordem.length })
            }
          }
          aoEvento({ tipo: "progresso", tabela: nome, feitas, total: resumo.noArquivo, tabelasConcluidas: indice + 1, totalTabelas: ordem.length })
          if (!opcoes.simular && resumo.novos > 0) await ajustarContadores(ctx, modelo)
        }

        const resultado: ResultadoRestauracao = {
          simulacao: opcoes.simular,
          modo: opcoes.modo,
          backup: lido,
          tabelas: resumos,
          avisos: montarAvisos(ctx, resumos, desconhecidas, secoesSemDados),
          duracaoMs: Date.now() - inicio,
        }

        if (!opcoes.simular) {
          const soma = (campo: "novos" | "atualizados") => resumos.reduce((total, r) => total + r[campo], 0)
          const ignorados = resumos.reduce((total, r) => total + totalIgnorados(r), 0)
          await recordAppLog({
            nivel: ignorados > 0 ? "aviso" : "info",
            origem: "backup",
            mensagem: `Restauração concluída: ${soma("novos")} criados, ${soma("atualizados")} atualizados, ${ignorados} ignorados.`,
            detalhes: resultado.avisos.join("\n") || undefined,
          })
        }
        return resultado
      } catch (erro) {
        if (!opcoes.simular) {
          await recordAppLog({
            nivel: "erro",
            origem: "backup",
            mensagem: "A restauração do backup falhou.",
            detalhes: erro,
          })
        }
        throw erro
      } finally {
        await liberar()
      }
    }

    return { cabecalho: lido, executar, descartar: liberar }
  } catch (erro) {
    await liberar()
    if (erro instanceof ArquivoInvalidoError) throw new RestauracaoError(erro.message)
    throw erro
  }
}
