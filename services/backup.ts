import { createHmac } from "node:crypto"

import { prisma } from "@/lib/prisma"
import { proximaExecucao, type AgendaBackup } from "@/lib/backup/agenda"
import { COLUNAS_SECRETAS, normalizarSecoes, SECOES_BACKUP, SECOES_POR_CHAVE } from "@/lib/backup/secoes"
import { recordAppLog } from "@/services/app-logs"

/**
 * Backup para webhook externo (manual e automático).
 *
 * Como funciona:
 * - O usuário escolhe as seções (ver `lib/backup/secoes.ts`). Cada tabela das
 *   seções é lida em páginas e enviada em vários POSTs (`backup.parte`), para não
 *   carregar o banco inteiro na memória nem estourar o limite de corpo do destino.
 * - No fim sai um POST `backup.concluido` com o resumo (linhas e partes por
 *   tabela), para o destino conferir que recebeu tudo.
 * - Todos os envios de um backup levam o mesmo `X-Backup-Id`; `X-Backup-Part`
 *   (tabela:índice) identifica a parte. Reenvios são idempotentes por (id, parte).
 * - Automático: a próxima execução fica em `BackupConfig.autoProximoEm`. Quem
 *   conseguir "reservar" esse valor roda o backup, então várias instâncias do app
 *   não duplicam. Se falhar, o backup automático é repetido com espera crescente.
 * - Segredos nunca saem: hash de senha dos usuários, segredo dos webhooks e o
 *   segredo de assinatura do webhook de execuções são removidos.
 */

const ID_CONFIG = "default"
const TIMEOUT_PARTE_MS = 30_000
const TENTATIVAS_POR_PARTE = 3
const ESPERA_PARTE_MS = [1_000, 4_000]
/** Sem sinal de vida por tanto tempo = o processo caiu no meio do envio. */
const SEM_SINAL_MS = 5 * 60 * 1000
const MAX_TENTATIVAS_AUTOMATICO = 5
const ESPERA_MAXIMA_RETENTATIVA_MS = 60 * 60 * 1000
const HISTORICO_MAXIMO = 50
const RETENTATIVAS_POR_VARREDURA = 2

export const EVENTO_PARTE = "backup.parte"
export const EVENTO_CONCLUIDO = "backup.concluido"
export const EVENTO_TESTE = "backup.teste"

// ---------------------------------------------------------------------------
// Leitores: como ler cada tabela, em páginas
// ---------------------------------------------------------------------------

interface Leitor {
  contar: () => Promise<number>
  /** Próxima página depois de `depoisDeId` (null = primeira). */
  pagina: (depoisDeId: string | null, tamanho: number) => Promise<Array<Record<string, unknown>>>
  /** Linhas por parte enviada. */
  tamanho: number
  /** Tabela sem `id` próprio: lida inteira numa única passada. */
  unicaPagina?: boolean
  /** Colunas que nunca saem do app. */
  omitir?: string[]
}

interface DelegateLoose {
  count: () => Promise<number>
  findMany: (args: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>
}

function porId(delegate: unknown, opcoes: { tamanho?: number; omitir?: string[] } = {}): Leitor {
  const d = delegate as DelegateLoose
  return {
    contar: () => d.count(),
    pagina: (depoisDeId, tamanho) =>
      d.findMany({
        orderBy: { id: "asc" },
        take: tamanho,
        ...(depoisDeId ? { cursor: { id: depoisDeId }, skip: 1 } : {}),
      }),
    tamanho: opcoes.tamanho ?? 1000,
    omitir: opcoes.omitir,
  }
}

const LEITORES: Record<string, Leitor> = {
  Lead: porId(prisma.lead),
  ChatInternalNote: porId(prisma.chatInternalNote),
  Campaign: porId(prisma.campaign),
  CampaignMessage: porId(prisma.campaignMessage),
  LeadCampaign: porId(prisma.leadCampaign),
  Produto: porId(prisma.produto),
  Marca: porId(prisma.marca),
  Persona: porId(prisma.persona),
  Regiao: porId(prisma.regiao),
  ScheduledMessage: porId(prisma.scheduledMessage),
  TimelineEvent: porId(prisma.timelineEvent, { tamanho: 2000 }),
  Departamento: porId(prisma.departamento),
  Atendente: porId(prisma.atendente),
  LeadAtendimento: {
    // A chave primária é o próprio leadId.
    contar: () => prisma.leadAtendimento.count(),
    pagina: (depoisDeId, tamanho) =>
      prisma.leadAtendimento.findMany({
        orderBy: { leadId: "asc" },
        take: tamanho,
        ...(depoisDeId ? { cursor: { leadId: depoisDeId }, skip: 1 } : {}),
      }) as unknown as Promise<Array<Record<string, unknown>>>,
    tamanho: 1000,
  },
  AtendenteDepartamento: {
    // Chave composta, sem `id`: tabela pequena (vínculos), lida de uma vez.
    contar: () => prisma.atendenteDepartamento.count(),
    pagina: () =>
      prisma.atendenteDepartamento.findMany({
        orderBy: [{ atendenteId: "asc" }, { departamentoId: "asc" }],
        take: 50_000,
      }) as unknown as Promise<Array<Record<string, unknown>>>,
    tamanho: 50_000,
    unicaPagina: true,
  },
  AtendimentoTransferencia: porId(prisma.atendimentoTransferencia),
  NoCodeFlow: porId(prisma.noCodeFlow, { tamanho: 200, omitir: [...COLUNAS_SECRETAS.NoCodeFlow] }),
  NoCodeExecution: porId(prisma.noCodeExecution, { tamanho: 300 }),
  User: porId(prisma.user, { omitir: [...COLUNAS_SECRETAS.User] }),
  Webhook: porId(prisma.webhook, { omitir: [...COLUNAS_SECRETAS.Webhook] }),
  Instance: porId(prisma.instance),
  Settings: porId(prisma.settings, { tamanho: 10 }),
  InboundEvent: porId(prisma.inboundEvent, { tamanho: 500 }),
  AppLog: porId(prisma.appLog, { tamanho: 2000 }),
}

function limpar(linhas: Array<Record<string, unknown>>, omitir?: string[]) {
  if (!omitir?.length) return linhas
  return linhas.map((linha) => {
    const copia = { ...linha }
    for (const campo of omitir) delete copia[campo]
    return copia
  })
}

/** Quantas linhas cada seção tem hoje (para a tela mostrar o tamanho de cada opção). `null` = não foi possível contar. */
export async function contarLinhasPorSecao(): Promise<Record<string, number | null>> {
  const entradas = await Promise.all(
    SECOES_BACKUP.map(async (secao) => {
      try {
        const contagens = await Promise.all(secao.tabelas.map((t) => LEITORES[t].contar()))
        return [secao.chave, contagens.reduce((a, b) => a + b, 0)] as const
      } catch {
        return [secao.chave, null] as const
      }
    }),
  )
  return Object.fromEntries(entradas)
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export interface ConfigBackup {
  url: string
  temSegredo: boolean
  secoes: string[]
  auto: AgendaBackup & { ativo: boolean; proximoEm: string | null }
}

type LinhaConfig = NonNullable<Awaited<ReturnType<typeof prisma.backupConfig.findUnique>>>

function paraConfig(row: LinhaConfig | null): ConfigBackup {
  return {
    url: row?.url ?? "",
    temSegredo: Boolean(row?.segredo),
    secoes: normalizarSecoes(row?.secoes ?? []),
    auto: {
      ativo: row?.autoAtivo ?? false,
      modo: (row?.autoModo as AgendaBackup["modo"]) ?? "diario",
      intervaloHoras: row?.autoIntervaloHoras ?? 24,
      horario: row?.autoHorario ?? "03:00",
      diaSemana: row?.autoDiaSemana ?? 0,
      proximoEm: row?.autoProximoEm ? row.autoProximoEm.toISOString() : null,
    },
  }
}

export async function getConfigBackup(): Promise<ConfigBackup> {
  return paraConfig(await prisma.backupConfig.findUnique({ where: { id: ID_CONFIG } }))
}

export async function segredoSalvoBackup(): Promise<string | null> {
  const row = await prisma.backupConfig.findUnique({ where: { id: ID_CONFIG }, select: { segredo: true } })
  return row?.segredo ?? null
}

export async function salvarConfigBackup(input: {
  url: string
  /** `undefined` mantém o segredo atual; `null` remove; texto define. */
  segredo?: string | null
  secoes: string[]
  auto: AgendaBackup & { ativo: boolean }
}): Promise<ConfigBackup> {
  const agora = new Date()
  const agenda: AgendaBackup = {
    modo: input.auto.modo,
    intervaloHoras: input.auto.intervaloHoras,
    horario: input.auto.horario,
    diaSemana: input.auto.diaSemana,
  }

  const atual = await prisma.backupConfig.findUnique({ where: { id: ID_CONFIG } })
  // Recalcula a próxima execução quando o automático liga ou a agenda muda; senão mantém a já marcada.
  const agendaMudou =
    !atual ||
    atual.autoModo !== agenda.modo ||
    atual.autoIntervaloHoras !== agenda.intervaloHoras ||
    atual.autoHorario !== agenda.horario ||
    atual.autoDiaSemana !== agenda.diaSemana
  const autoProximoEm = !input.auto.ativo
    ? null
    : !atual?.autoAtivo || agendaMudou || !atual.autoProximoEm
      ? proximaExecucao(agenda, agora)
      : atual.autoProximoEm

  const dados = {
    url: input.url,
    ...(input.segredo !== undefined ? { segredo: input.segredo } : {}),
    secoes: input.secoes,
    autoAtivo: input.auto.ativo,
    autoModo: agenda.modo,
    autoIntervaloHoras: agenda.intervaloHoras,
    autoHorario: agenda.horario,
    autoDiaSemana: agenda.diaSemana,
    autoProximoEm,
  }
  const row = await prisma.backupConfig.upsert({
    where: { id: ID_CONFIG },
    create: { id: ID_CONFIG, ...dados },
    update: dados,
  })
  return paraConfig(row)
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------

export interface BackupRow {
  id: string
  origem: "manual" | "automatico" | "download"
  status: "enviando" | "enviado" | "falha"
  secoes: string[]
  resumo: Record<string, { linhas: number; partes: number }> | null
  partesEnviadas: number
  partesTotal: number
  bytes: number
  tentativas: number
  /** Falhou e o app ainda vai tentar sozinho. */
  vaiTentarDeNovo: boolean
  erro: string | null
  criadoEm: string
  concluidoEm: string | null
}

type LinhaExecucao = NonNullable<Awaited<ReturnType<typeof prisma.backupExecucao.findUnique>>>

function paraBackup(row: LinhaExecucao): BackupRow {
  return {
    id: row.id,
    origem: row.origem as BackupRow["origem"],
    status: row.status as BackupRow["status"],
    secoes: row.secoes,
    resumo: (row.resumo as BackupRow["resumo"]) ?? null,
    partesEnviadas: row.partesEnviadas,
    partesTotal: row.partesTotal,
    bytes: row.bytes,
    tentativas: row.tentativas,
    vaiTentarDeNovo: row.status === "falha" && row.origem === "automatico" && row.tentativas < MAX_TENTATIVAS_AUTOMATICO,
    erro: row.erro,
    criadoEm: row.criadoEm.toISOString(),
    concluidoEm: row.concluidoEm ? row.concluidoEm.toISOString() : null,
  }
}

export async function listarBackups(limite = 20): Promise<BackupRow[]> {
  const rows = await prisma.backupExecucao.findMany({
    orderBy: { criadoEm: "desc" },
    take: Math.min(Math.max(limite, 1), HISTORICO_MAXIMO),
  })
  return rows.map(paraBackup)
}

async function podarHistorico() {
  const antigos = await prisma.backupExecucao.findMany({
    orderBy: { criadoEm: "desc" },
    skip: HISTORICO_MAXIMO,
    select: { id: true },
  })
  if (antigos.length) await prisma.backupExecucao.deleteMany({ where: { id: { in: antigos.map((a) => a.id) } } })
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

interface Destino {
  url: string
  segredo: string | null
}

interface ResultadoEnvio {
  ok: boolean
  status?: number
  erro?: string
  bytes: number
}

async function postarUmaVez(
  destino: Destino,
  evento: string,
  corpo: unknown,
  backupId: string,
  parte: string,
  tentativa: number,
): Promise<ResultadoEnvio> {
  const texto = JSON.stringify(corpo)
  const bytes = Buffer.byteLength(texto)
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "painel-campanhas-backup/1.0",
    "x-backup-event": evento,
    "x-backup-id": backupId,
    "x-backup-part": parte,
    "x-backup-attempt": String(tentativa),
  }
  if (destino.segredo) {
    headers["x-backup-signature"] = `sha256=${createHmac("sha256", destino.segredo).update(texto).digest("hex")}`
  }

  try {
    const resposta = await fetch(destino.url, {
      method: "POST",
      headers,
      body: texto,
      cache: "no-store",
      // Redirecionar um POST reenviaria o backup para outro endereço sem você ver.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_PARTE_MS),
    })
    if (resposta.status >= 200 && resposta.status < 300) return { ok: true, status: resposta.status, bytes }

    const detalhe = (await resposta.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 200)
    const redirecionou = resposta.status >= 300 && resposta.status < 400
    return {
      ok: false,
      status: resposta.status,
      bytes,
      erro: `${redirecionou ? "O destino respondeu com redirecionamento" : "O destino respondeu"} (HTTP ${resposta.status})${detalhe ? `: ${detalhe}` : ""}`,
    }
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
    return {
      ok: false,
      bytes,
      erro: timeout ? `Sem resposta em ${TIMEOUT_PARTE_MS / 1000}s.` : error instanceof Error ? error.message : String(error),
    }
  }
}

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Erros do cliente (exceto "tempo esgotado" e "muitas requisições") não melhoram repetindo. */
function vale(resultado: ResultadoEnvio): boolean {
  const s = resultado.status
  return !s || s >= 500 || s === 408 || s === 429
}

async function postarComRepeticao(
  destino: Destino,
  evento: string,
  corpo: unknown,
  backupId: string,
  parte: string,
): Promise<ResultadoEnvio> {
  let ultimo: ResultadoEnvio = { ok: false, bytes: 0, erro: "Falha desconhecida." }
  for (let tentativa = 1; tentativa <= TENTATIVAS_POR_PARTE; tentativa++) {
    ultimo = await postarUmaVez(destino, evento, corpo, backupId, parte, tentativa)
    if (ultimo.ok || !vale(ultimo)) return ultimo
    if (tentativa < TENTATIVAS_POR_PARTE) await dormir(ESPERA_PARTE_MS[tentativa - 1] ?? 4_000)
  }
  return ultimo
}

/** Envia uma mensagem pequena de teste, sem ler nenhuma tabela. */
export async function enviarTesteBackup(destino: Destino, secoes: string[]): Promise<{ ok: boolean; message: string }> {
  const corpo = {
    evento: EVENTO_TESTE,
    enviadoEm: new Date().toISOString(),
    backup: { id: "teste-backup", origem: "teste", secoes },
    mensagem: "Se você recebeu isto, o destino está pronto para receber os backups.",
  }
  const resultado = await postarUmaVez(destino, EVENTO_TESTE, corpo, "teste-backup", "teste", 1)
  return resultado.ok
    ? { ok: true, message: `Teste enviado: o destino respondeu HTTP ${resultado.status}.` }
    : { ok: false, message: resultado.erro ?? "Não foi possível enviar o teste." }
}

// ---------------------------------------------------------------------------
// Execução de um backup
// ---------------------------------------------------------------------------

async function registrarFalha(id: string, erro: string, tentativas: number, origem: string): Promise<false> {
  await prisma.backupExecucao
    .update({ where: { id }, data: { status: "falha", erro, concluidoEm: null, ultimaTentativaEm: new Date() } })
    .catch(() => undefined)
  // Loga a primeira falha e a definitiva; as repetições aparecem no próprio histórico.
  const definitiva = origem !== "automatico" || tentativas >= MAX_TENTATIVAS_AUTOMATICO
  if (tentativas === 1 || definitiva) {
    await recordAppLog({
      nivel: definitiva ? "erro" : "aviso",
      origem: "backup",
      mensagem: definitiva
        ? `Backup ${id} falhou.`
        : `Backup automático ${id} falhou. Vamos tentar de novo automaticamente.`,
      detalhes: erro,
    }).catch(() => undefined)
  }
  return false
}

/**
 * Lê as tabelas e envia tudo ao webhook. Assume que a execução já foi reservada
 * (criada como "enviando" ou reservada para retentativa). Nunca lança.
 */
async function executarBackup(id: string): Promise<boolean> {
  let tentativas = 1
  let origem = "manual"
  try {
    const run = await prisma.backupExecucao.findUnique({ where: { id } })
    if (!run) return false
    tentativas = run.tentativas
    origem = run.origem

    const config = await prisma.backupConfig.findUnique({ where: { id: ID_CONFIG } })
    if (!config?.url) return await registrarFalha(id, "Nenhum webhook de backup configurado.", tentativas, origem)
    const destino: Destino = { url: config.url, segredo: config.segredo }

    const secoes = normalizarSecoes(run.secoes)
    if (!secoes.length) return await registrarFalha(id, "Nenhuma seção selecionada.", tentativas, origem)
    const tabelas = secoes.flatMap((secao) => SECOES_POR_CHAVE[secao].tabelas.map((tabela) => ({ secao, tabela })))

    // Estimativa de partes (para a barra de progresso); o resumo final usa os números reais.
    const contagens = await Promise.all(tabelas.map((t) => LEITORES[t.tabela].contar()))
    const partesTotal =
      contagens.reduce((soma, linhas, i) => soma + Math.ceil(linhas / LEITORES[tabelas[i].tabela].tamanho), 0) + 1
    await prisma.backupExecucao.update({
      where: { id },
      data: { partesTotal, partesEnviadas: 0, bytes: 0, resumo: undefined, ultimaTentativaEm: new Date() },
    })

    const meta = { id, origem, iniciadoEm: run.criadoEm.toISOString(), secoes }
    const resumo: Record<string, { linhas: number; partes: number }> = {}
    let partesEnviadas = 0
    let bytes = 0

    for (const { secao, tabela } of tabelas) {
      const leitor = LEITORES[tabela]
      let cursor: string | null = null
      let indice = 0
      let linhas = 0

      for (;;) {
        const pagina = await leitor.pagina(cursor, leitor.tamanho)
        if (!pagina.length) break

        const nome = `${tabela}:${indice}`
        const corpo = {
          evento: EVENTO_PARTE,
          enviadoEm: new Date().toISOString(),
          backup: meta,
          parte: { secao, tabela, indice, linhas: pagina.length },
          dados: limpar(pagina, leitor.omitir),
        }
        const resultado = await postarComRepeticao(destino, EVENTO_PARTE, corpo, id, nome)
        if (!resultado.ok) {
          return await registrarFalha(id, `Parte ${nome}: ${resultado.erro ?? "falha desconhecida."}`, tentativas, origem)
        }

        bytes += resultado.bytes
        partesEnviadas += 1
        linhas += pagina.length
        indice += 1
        await prisma.backupExecucao.update({
          where: { id },
          data: { partesEnviadas, bytes: Math.min(bytes, 2_147_483_647), ultimaTentativaEm: new Date() },
        })

        if (leitor.unicaPagina || pagina.length < leitor.tamanho) break
        const ultima = pagina[pagina.length - 1]
        // A chave de paginação é `id` (ou `leadId` em LeadAtendimento, que não tem `id`).
        cursor = String(ultima.id ?? ultima.leadId)
      }
      resumo[tabela] = { linhas, partes: indice }
    }

    const concluido = await postarComRepeticao(
      destino,
      EVENTO_CONCLUIDO,
      {
        evento: EVENTO_CONCLUIDO,
        enviadoEm: new Date().toISOString(),
        backup: meta,
        totalPartes: partesEnviadas,
        resumo,
      },
      id,
      "concluido",
    )
    if (!concluido.ok) {
      return await registrarFalha(id, `Resumo final: ${concluido.erro ?? "falha desconhecida."}`, tentativas, origem)
    }

    await prisma.backupExecucao.update({
      where: { id },
      data: {
        status: "enviado",
        erro: null,
        resumo: resumo as never,
        partesEnviadas: partesEnviadas + 1,
        bytes: Math.min(bytes + concluido.bytes, 2_147_483_647),
        concluidoEm: new Date(),
        ultimaTentativaEm: new Date(),
      },
    })
    return true
  } catch (error) {
    return registrarFalha(id, error instanceof Error ? error.message : String(error), tentativas, origem)
  }
}

/** Cria um backup já como "enviando" e o executa em segundo plano (não espera terminar). */
async function dispararBackup(origem: "manual" | "automatico", secoes: string[]): Promise<string> {
  const run = await prisma.backupExecucao.create({
    data: { origem, status: "enviando", secoes, tentativas: 1, ultimaTentativaEm: new Date() },
    select: { id: true },
  })
  void executarBackup(run.id)
  await podarHistorico().catch(() => undefined)
  return run.id
}

export type ResultadoInicio = { ok: true; id: string } | { ok: false; erro: string }

/** Backup manual: usa o webhook salvo e as seções escolhidas na tela. */
export async function iniciarBackupManual(secoesEscolhidas: unknown): Promise<ResultadoInicio> {
  const secoes = normalizarSecoes(secoesEscolhidas)
  if (!secoes.length) return { ok: false, erro: "Selecione ao menos uma seção para o backup." }

  const config = await prisma.backupConfig.findUnique({ where: { id: ID_CONFIG }, select: { url: true } })
  if (!config?.url) return { ok: false, erro: "Salve a URL do webhook de backup antes de fazer o backup." }

  const emAndamento = await prisma.backupExecucao.findFirst({
    where: { status: "enviando", ultimaTentativaEm: { gte: new Date(Date.now() - SEM_SINAL_MS) } },
    select: { id: true },
  })
  if (emAndamento) return { ok: false, erro: "Já existe um backup em andamento. Aguarde ele terminar." }

  return { ok: true, id: await dispararBackup("manual", secoes) }
}

/** Reenvia um backup que falhou (a pedido do usuário). Lê os dados de novo, com o mesmo id. */
export async function retentarBackup(id: string): Promise<{ ok: boolean; erro?: string }> {
  const reservado = await reservarRetentativa(id)
  if (!reservado) return { ok: false, erro: "Este backup não está em um estado que permita tentar de novo." }
  void executarBackup(id)
  return { ok: true }
}

async function reservarRetentativa(id: string): Promise<boolean> {
  const agora = new Date()
  const reserva = await prisma.backupExecucao.updateMany({
    where: { id, status: "falha", origem: { not: "download" } },
    data: {
      status: "enviando",
      tentativas: { increment: 1 },
      ultimaTentativaEm: agora,
      concluidoEm: null,
      partesEnviadas: 0,
    },
  })
  return reserva.count === 1
}

// ---------------------------------------------------------------------------
// Download (sem webhook): o mesmo conteúdo, num único arquivo .json
// ---------------------------------------------------------------------------

export type ResultadoDownload =
  | { ok: true; stream: ReadableStream<Uint8Array>; nome: string }
  | { ok: false; erro: string }

/**
 * Gera o backup como arquivo para baixar, sem precisar de webhook. É lido e
 * escrito aos poucos (nada de carregar o banco inteiro na memória) e fica no
 * histórico como "Download". Formato:
 * `{ formato, versao, id, geradoEm, secoes, tabelas: { Lead: [...], ... } }`.
 */
export async function criarDownloadBackup(secoesEscolhidas: unknown): Promise<ResultadoDownload> {
  const secoes = normalizarSecoes(secoesEscolhidas)
  if (!secoes.length) return { ok: false, erro: "Selecione ao menos uma seção para o backup." }
  const tabelas = secoes.flatMap((secao) => SECOES_POR_CHAVE[secao].tabelas.map((tabela) => ({ secao, tabela })))

  const run = await prisma.backupExecucao.create({
    data: { origem: "download", status: "enviando", secoes, tentativas: 1, ultimaTentativaEm: new Date() },
    select: { id: true, criadoEm: true },
  })
  await podarHistorico().catch(() => undefined)

  const codificador = new TextEncoder()
  const resumo: Record<string, { linhas: number; partes: number }> = {}
  let bytes = 0
  let finalizado = false

  async function* gerar(): AsyncGenerator<string> {
    yield `{"formato":"painel-backup","versao":1,"id":${JSON.stringify(run.id)},"geradoEm":${JSON.stringify(run.criadoEm.toISOString())},"secoes":${JSON.stringify(secoes)},"tabelas":{`
    let primeiraTabela = true
    for (const { tabela } of tabelas) {
      const leitor = LEITORES[tabela]
      yield `${primeiraTabela ? "" : ","}${JSON.stringify(tabela)}:[`
      primeiraTabela = false

      let cursor: string | null = null
      let partes = 0
      let linhas = 0
      for (;;) {
        const pagina = await leitor.pagina(cursor, leitor.tamanho)
        if (!pagina.length) break
        const texto = limpar(pagina, leitor.omitir)
          .map((linha) => JSON.stringify(linha))
          .join(",")
        yield `${linhas > 0 ? "," : ""}${texto}`
        linhas += pagina.length
        partes += 1
        await prisma.backupExecucao
          .update({ where: { id: run.id }, data: { partesEnviadas: partes, ultimaTentativaEm: new Date() } })
          .catch(() => undefined)
        if (leitor.unicaPagina || pagina.length < leitor.tamanho) break
        const ultima = pagina[pagina.length - 1]
        cursor = String(ultima.id ?? ultima.leadId)
      }
      resumo[tabela] = { linhas, partes }
      yield "]"
    }
    yield "}}"
  }

  async function finalizar(status: "enviado" | "falha", erro: string | null) {
    if (finalizado) return
    finalizado = true
    await prisma.backupExecucao
      .update({
        where: { id: run.id },
        data: {
          status,
          erro,
          resumo: resumo as never,
          bytes: Math.min(bytes, 2_147_483_647),
          concluidoEm: status === "enviado" ? new Date() : null,
          ultimaTentativaEm: new Date(),
        },
      })
      .catch(() => undefined)
    if (status === "falha") {
      await recordAppLog({ nivel: "erro", origem: "backup", mensagem: `Download do backup ${run.id} falhou.`, detalhes: erro }).catch(
        () => undefined,
      )
    }
  }

  const iterador = gerar()
  const stream = new ReadableStream<Uint8Array>({
    async pull(controlador) {
      try {
        const { value, done } = await iterador.next()
        if (done) {
          await finalizar("enviado", null)
          controlador.close()
          return
        }
        const pedaco = codificador.encode(value)
        bytes += pedaco.byteLength
        controlador.enqueue(pedaco)
      } catch (error) {
        await finalizar("falha", error instanceof Error ? error.message : String(error))
        controlador.error(error)
      }
    },
    async cancel() {
      await iterador.return(undefined).catch(() => undefined)
      await finalizar("falha", "Download cancelado antes de terminar.")
    },
  })

  const d = run.criadoEm
  const dois = (n: number) => String(n).padStart(2, "0")
  const nome = `backup-${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}-${dois(d.getHours())}${dois(d.getMinutes())}.json`
  return { ok: true, stream, nome }
}

// ---------------------------------------------------------------------------
// Rotina periódica (timer interno + /api/cron)
// ---------------------------------------------------------------------------

function esperaRetentativa(tentativas: number): number {
  return Math.min(60_000 * 2 ** Math.max(tentativas, 1), ESPERA_MAXIMA_RETENTATIVA_MS)
}

let manutencaoEmAndamento = false

export interface ResultadoManutencaoBackup {
  iniciado: boolean
  retentados: number
  ignorado?: boolean
}

/** Dispara o backup automático na hora marcada e repete os automáticos que falharam. */
export async function manutencaoBackup(): Promise<ResultadoManutencaoBackup> {
  if (manutencaoEmAndamento) return { iniciado: false, retentados: 0, ignorado: true }
  manutencaoEmAndamento = true
  try {
    const agora = new Date()

    // Backups que ficaram "enviando" sem sinal de vida (processo caiu) viram falha para poderem ser repetidos.
    await prisma.backupExecucao.updateMany({
      where: { status: "enviando", ultimaTentativaEm: { lt: new Date(agora.getTime() - SEM_SINAL_MS) } },
      data: { status: "falha", erro: "Interrompido antes de terminar (o app reiniciou ou parou de responder)." },
    })

    let iniciado = false
    const config = await prisma.backupConfig.findUnique({ where: { id: ID_CONFIG } })
    if (config?.autoAtivo && config.url) {
      const agenda: AgendaBackup = {
        modo: config.autoModo as AgendaBackup["modo"],
        intervaloHoras: config.autoIntervaloHoras,
        horario: config.autoHorario,
        diaSemana: config.autoDiaSemana,
      }
      if (!config.autoProximoEm) {
        // Automático ligado sem próxima execução marcada (ex.: edição direta no banco): marca agora.
        await prisma.backupConfig.updateMany({
          where: { id: ID_CONFIG, autoProximoEm: null },
          data: { autoProximoEm: proximaExecucao(agenda, agora) },
        })
      } else if (config.autoProximoEm.getTime() <= agora.getTime()) {
        // Reserva a execução: só quem conseguir mover `autoProximoEm` roda (vale entre várias instâncias).
        const reserva = await prisma.backupConfig.updateMany({
          where: { id: ID_CONFIG, autoAtivo: true, autoProximoEm: config.autoProximoEm },
          data: { autoProximoEm: proximaExecucao(agenda, agora) },
        })
        if (reserva.count === 1) {
          const secoes = normalizarSecoes(config.secoes)
          const emAndamento = await prisma.backupExecucao.findFirst({
            where: { status: "enviando", ultimaTentativaEm: { gte: new Date(agora.getTime() - SEM_SINAL_MS) } },
            select: { id: true },
          })
          if (emAndamento) {
            // Um backup ainda está sendo enviado: pula esta rodada (a próxima já foi marcada).
          } else if (secoes.length) {
            await dispararBackup("automatico", secoes)
            iniciado = true
          } else {
            await recordAppLog({
              nivel: "aviso",
              origem: "backup",
              mensagem: "Backup automático não executado: nenhuma seção selecionada.",
            }).catch(() => undefined)
          }
        }
      }
    }

    // Repete os automáticos que falharam, com espera crescente, até o limite de tentativas.
    let retentados = 0
    if (config?.url) {
      const falhos = await prisma.backupExecucao.findMany({
        where: { origem: "automatico", status: "falha", tentativas: { lt: MAX_TENTATIVAS_AUTOMATICO } },
        orderBy: { criadoEm: "asc" },
        take: 10,
      })
      const devidos = falhos
        .filter((f) => !f.ultimaTentativaEm || agora.getTime() - f.ultimaTentativaEm.getTime() >= esperaRetentativa(f.tentativas))
        .slice(0, RETENTATIVAS_POR_VARREDURA)
      for (const f of devidos) {
        if (await reservarRetentativa(f.id)) {
          void executarBackup(f.id)
          retentados += 1
        }
      }
    }

    return { iniciado, retentados }
  } finally {
    manutencaoEmAndamento = false
  }
}
