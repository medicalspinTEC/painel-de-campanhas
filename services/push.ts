import { fromZonedTime } from "date-fns-tz"
import webpush from "web-push"

import { isUserRole } from "@/lib/permissoes"
import { prismaGlobal as db } from "@/lib/prisma"
import {
  AGENDA_MAX_DIAS,
  AGENDA_MIN_MS,
  FUSO_PUSH,
  STATUS_EDITAVEIS,
  STATUS_PUSH,
  plataformaDoUserAgent,
  validarEntradaPush,
  type AparelhoPush,
  type PlataformaPush,
  type PublicoEntrada,
  type PushEntrada,
  type PushItem,
  type ResumoPush,
  type StatusPush,
  type UsuarioPush,
} from "@/lib/push"
import { recordAppLog } from "@/services/app-logs"

/**
 * Notificações push do PWA (avisos externos, com o app fechado).
 *
 * - O Root cria a notificação na tela "Notificações push": enviar agora, agendar ou guardar como
 *   rascunho. Dá para editar (rascunho/agendada/cancelada/falha), cancelar agendamentos, reenviar
 *   e duplicar.
 * - O envio usa o protocolo Web Push (VAPID) pela biblioteca `web-push`. As chaves ficam nas
 *   variáveis de ambiente VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT.
 * - As tabelas são GLOBAIS (sem `workspaceId`): o Root avisa todas as instâncias, então este
 *   serviço usa `prismaGlobal` de propósito.
 * - Agendadas: `manutencaoPush()` roda a cada 30 s (instrumentation.ts) e em `/api/cron`. Quem
 *   conseguir "reservar" a notificação (status agendada → enviando, em um UPDATE atômico) é quem
 *   envia, então várias instâncias do app não duplicam o envio.
 * - Aparelho que responde 404/410 (app desinstalado ou permissão revogada) é apagado na hora;
 *   falhas seguidas (MAX_FALHAS) também apagam a assinatura.
 */

const LOTE = 20
const TTL_SEGUNDOS = 24 * 60 * 60
const TIMEOUT_ENTREGA_MS = 15_000
const SEM_SINAL_MS = 5 * 60 * 1000
const MAX_FALHAS = 5
const MAX_AGENDADAS_POR_VARREDURA = 5
const HISTORICO_LISTA = 100

// ---------------------------------------------------------------------------
// Configuração (chaves VAPID)
// ---------------------------------------------------------------------------

const VARIAVEIS = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const

export function faltandoConfigPush(): string[] {
  return VARIAVEIS.filter((nome) => !process.env[nome]?.trim())
}

export function pushConfigurado(): boolean {
  return faltandoConfigPush().length === 0
}

export function chavePublicaPush(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null
}

function detalhesVapid() {
  let subject = process.env.VAPID_SUBJECT?.trim() ?? ""
  if (subject.includes("@") && !/^(mailto:|https:)/i.test(subject)) subject = `mailto:${subject}`
  return {
    subject,
    publicKey: process.env.VAPID_PUBLIC_KEY?.trim() ?? "",
    privateKey: process.env.VAPID_PRIVATE_KEY?.trim() ?? "",
  }
}

/** Gera um par de chaves VAPID novo (só para exibir ao Root quando ainda não há chaves). */
export function gerarChavesVapid(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys()
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

type LinhaNotificacao = NonNullable<Awaited<ReturnType<typeof db.pushNotificacao.findUnique>>>

function paraItem(r: LinhaNotificacao): PushItem {
  return {
    id: r.id,
    titulo: r.titulo,
    corpo: r.corpo,
    url: r.url,
    imagem: r.imagem,
    urgente: r.urgente,
    publico: (r.publico === "papeis" || r.publico === "usuarios" ? r.publico : "todos") as PushItem["publico"],
    papeis: r.papeis.filter(isUserRole),
    usuarioIds: r.usuarioIds,
    somenteInstalados: r.somenteInstalados,
    status: (STATUS_PUSH as readonly string[]).includes(r.status) ? (r.status as StatusPush) : "falha",
    agendadaPara: r.agendadaPara ? r.agendadaPara.toISOString() : null,
    enviadaEm: r.enviadaEm ? r.enviadaEm.toISOString() : null,
    totalAlvos: r.totalAlvos,
    enviados: r.enviados,
    falhas: r.falhas,
    removidos: r.removidos,
    erro: r.erro,
    criadoPorNome: r.criadoPorNome,
    criadoEm: r.criadoEm.toISOString(),
  }
}

export async function listarPush(limite = HISTORICO_LISTA): Promise<PushItem[]> {
  const rows = await db.pushNotificacao.findMany({
    orderBy: { criadoEm: "desc" },
    take: Math.min(Math.max(limite, 1), 300),
  })
  return rows.map(paraItem)
}

export async function resumoPush(): Promise<ResumoPush> {
  const [aparelhos, instalados, grupos, porUsuario] = await Promise.all([
    db.pushAssinatura.count(),
    db.pushAssinatura.count({ where: { instalado: true } }),
    db.pushAssinatura.groupBy({ by: ["plataforma"], _count: { _all: true } }),
    db.pushAssinatura.groupBy({ by: ["userId"] }),
  ])
  const porPlataforma: Record<PlataformaPush, number> = { ios: 0, android: 0, desktop: 0 }
  for (const g of grupos) {
    const chave = (g.plataforma === "ios" || g.plataforma === "android" ? g.plataforma : "desktop") as PlataformaPush
    porPlataforma[chave] += g._count._all
  }
  const faltando = faltandoConfigPush()
  return { configurado: faltando.length === 0, faltando, aparelhos, instalados, usuarios: porUsuario.length, porPlataforma }
}

export async function listarAparelhos(limite = 200): Promise<AparelhoPush[]> {
  const rows = await db.pushAssinatura.findMany({
    orderBy: { criadoEm: "desc" },
    take: Math.min(Math.max(limite, 1), 500),
    include: { user: { select: { nome: true, role: true } } },
  })
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    usuarioNome: r.user.nome,
    usuarioNivel: r.user.role,
    plataforma: (r.plataforma === "ios" || r.plataforma === "android" ? r.plataforma : "desktop") as PlataformaPush,
    instalado: r.instalado,
    falhas: r.falhas,
    criadoEm: r.criadoEm.toISOString(),
    ultimoEnvioEm: r.ultimoEnvioEm ? r.ultimoEnvioEm.toISOString() : null,
  }))
}

/** Usuários que já têm ao menos um aparelho inscrito (os únicos que dá para escolher um a um). */
export async function listarUsuariosComAparelho(): Promise<UsuarioPush[]> {
  const rows = await db.user.findMany({
    where: { ativo: true, pushAssinaturas: { some: {} } },
    orderBy: { nome: "asc" },
    select: { id: true, nome: true, username: true, role: true, _count: { select: { pushAssinaturas: true } } },
  })
  return rows.map((u) => ({ id: u.id, nome: u.nome, username: u.username, role: u.role, aparelhos: u._count.pushAssinaturas }))
}

// ---------------------------------------------------------------------------
// Público-alvo
// ---------------------------------------------------------------------------

async function filtroAlvos(p: PublicoEntrada) {
  // Usuários de instância suspensa não recebem.
  const inativas = (await db.workspace.findMany({ where: { ativo: false }, select: { id: true } })).map((w) => w.id)
  const user: Record<string, unknown> = { ativo: true }
  if (inativas.length) user.workspaceId = { notIn: inativas }
  if (p.publico === "papeis") user.role = { in: p.papeis }
  if (p.publico === "usuarios") user.id = { in: p.usuarioIds }
  return { ...(p.somenteInstalados ? { instalado: true } : {}), user }
}

/** Quantos aparelhos (e usuários) o público escolhido alcança hoje. */
export async function estimarAlcance(publico: PublicoEntrada): Promise<{ aparelhos: number; usuarios: number }> {
  const where = await filtroAlvos(publico)
  const [aparelhos, usuarios] = await Promise.all([
    db.pushAssinatura.count({ where }),
    db.pushAssinatura.groupBy({ by: ["userId"], where }),
  ])
  return { aparelhos, usuarios: usuarios.length }
}

// ---------------------------------------------------------------------------
// Entrega
// ---------------------------------------------------------------------------

interface Alvo {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

type Entrega = { ok: true } | { ok: false; invalida: boolean; erro: string }

async function entregar(alvo: Alvo, payload: string, urgente: boolean): Promise<Entrega> {
  try {
    await webpush.sendNotification({ endpoint: alvo.endpoint, keys: { p256dh: alvo.p256dh, auth: alvo.auth } }, payload, {
      TTL: TTL_SEGUNDOS,
      urgency: urgente ? "high" : "normal",
      timeout: TIMEOUT_ENTREGA_MS,
      vapidDetails: detalhesVapid(),
    })
    return { ok: true }
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    const mensagem = status ? `HTTP ${status}` : error instanceof Error ? error.message : String(error)
    return { ok: false, invalida: status === 404 || status === 410, erro: mensagem }
  }
}

function montarPayload(n: { id: string; titulo: string; corpo: string; url: string; imagem: string | null; urgente: boolean }, tag?: string) {
  return JSON.stringify({
    id: n.id,
    titulo: n.titulo,
    corpo: n.corpo,
    url: n.url,
    imagem: n.imagem,
    urgente: n.urgente,
    tag: tag ?? `push-${n.id}`,
  })
}

interface Contagem {
  enviados: number
  falhas: number
  removidos: number
  ultimoErro: string | null
}

/** Envia o payload para os aparelhos, em lotes, e atualiza as assinaturas conforme o resultado. */
async function enviarParaAlvos(
  alvos: Alvo[],
  payload: string,
  urgente: boolean,
  aoTerminarLote?: (parcial: Contagem) => Promise<void>,
): Promise<Contagem> {
  const total: Contagem = { enviados: 0, falhas: 0, removidos: 0, ultimoErro: null }

  for (let i = 0; i < alvos.length; i += LOTE) {
    const lote = alvos.slice(i, i + LOTE)
    const resultados = await Promise.all(lote.map((alvo) => entregar(alvo, payload, urgente)))

    const certos: string[] = []
    const invalidos: string[] = []
    const falhos: string[] = []
    resultados.forEach((resultado, indice) => {
      const id = lote[indice].id
      if (resultado.ok) certos.push(id)
      else {
        total.ultimoErro = resultado.erro
        if (resultado.invalida) invalidos.push(id)
        else falhos.push(id)
      }
    })

    if (certos.length) {
      await db.pushAssinatura.updateMany({ where: { id: { in: certos } }, data: { falhas: 0, ultimoEnvioEm: new Date() } })
    }
    if (invalidos.length) await db.pushAssinatura.deleteMany({ where: { id: { in: invalidos } } })
    let apagadosPorFalha = 0
    if (falhos.length) {
      await db.pushAssinatura.updateMany({ where: { id: { in: falhos } }, data: { falhas: { increment: 1 } } })
      const apagados = await db.pushAssinatura.deleteMany({ where: { id: { in: falhos }, falhas: { gte: MAX_FALHAS } } })
      apagadosPorFalha = apagados.count
    }

    total.enviados += certos.length
    total.falhas += falhos.length
    total.removidos += invalidos.length + apagadosPorFalha
    await aoTerminarLote?.(total)
  }
  return total
}

function textoDoErro(contagem: Contagem): string | null {
  if (!contagem.ultimoErro) return null
  const dica = /HTTP 40[13]/.test(contagem.ultimoErro)
    ? " O serviço de push recusou as chaves: se as chaves VAPID mudaram, cada usuário precisa reativar as notificações."
    : ""
  return `Último erro: ${contagem.ultimoErro}.${dica}`
}

// ---------------------------------------------------------------------------
// Execução de uma notificação
// ---------------------------------------------------------------------------

async function finalizar(id: string, status: "enviada" | "falha", dados: { erro?: string | null } & Partial<Contagem> = {}) {
  await db.pushNotificacao
    .update({
      where: { id },
      data: {
        status,
        erro: dados.erro ?? null,
        enviadaEm: status === "enviada" ? new Date() : null,
        ...(dados.enviados !== undefined ? { enviados: dados.enviados } : {}),
        ...(dados.falhas !== undefined ? { falhas: dados.falhas } : {}),
        ...(dados.removidos !== undefined ? { removidos: dados.removidos } : {}),
        ultimaVarreduraEm: new Date(),
      },
    })
    .catch(() => undefined)
}

/** Assume que a notificação já foi reservada (status "enviando"). Nunca lança. */
async function executarEnvio(id: string): Promise<void> {
  try {
    const n = await db.pushNotificacao.findUnique({ where: { id } })
    if (!n || n.status !== "enviando") return
    if (!pushConfigurado()) {
      await finalizar(id, "falha", { erro: "As chaves VAPID não estão configuradas no servidor." })
      return
    }

    const where = await filtroAlvos({
      publico: n.publico === "papeis" || n.publico === "usuarios" ? n.publico : "todos",
      papeis: n.papeis.filter(isUserRole),
      usuarioIds: n.usuarioIds,
      somenteInstalados: n.somenteInstalados,
    })
    const alvos = await db.pushAssinatura.findMany({ where, select: { id: true, endpoint: true, p256dh: true, auth: true } })
    await db.pushNotificacao.update({
      where: { id },
      data: { totalAlvos: alvos.length, enviados: 0, falhas: 0, removidos: 0, ultimaVarreduraEm: new Date() },
    })
    if (alvos.length === 0) {
      await finalizar(id, "falha", { erro: "Nenhum aparelho inscrito alcançado por este público." })
      return
    }

    const contagem = await enviarParaAlvos(alvos, montarPayload(n), n.urgente, async (parcial) => {
      await db.pushNotificacao
        .update({
          where: { id },
          data: { enviados: parcial.enviados, falhas: parcial.falhas, removidos: parcial.removidos, ultimaVarreduraEm: new Date() },
        })
        .catch(() => undefined)
    })

    if (contagem.enviados === 0) {
      await finalizar(id, "falha", { ...contagem, erro: `Nenhum aparelho recebeu. ${textoDoErro(contagem) ?? ""}`.trim() })
    } else {
      await finalizar(id, "enviada", {
        ...contagem,
        erro: contagem.falhas > 0 ? `${contagem.falhas} aparelho(s) não receberam. ${textoDoErro(contagem) ?? ""}`.trim() : null,
      })
    }
  } catch (error) {
    await finalizar(id, "falha", { erro: error instanceof Error ? error.message : String(error) })
    await recordAppLog({ nivel: "erro", origem: "push", mensagem: `Envio da notificação push ${id} falhou.`, detalhes: error }).catch(
      () => undefined,
    )
  }
}

/** Reserva (atômico) a notificação para envio. Só quem conseguir reservar envia. */
async function reservar(id: string, deStatus: readonly StatusPush[]): Promise<boolean> {
  const reserva = await db.pushNotificacao.updateMany({
    where: { id, status: { in: [...deStatus] } },
    data: {
      status: "enviando",
      erro: null,
      enviadaEm: null,
      totalAlvos: 0,
      enviados: 0,
      falhas: 0,
      removidos: 0,
      ultimaVarreduraEm: new Date(),
    },
  })
  return reserva.count === 1
}

// ---------------------------------------------------------------------------
// Criar, editar, enviar, cancelar, excluir
// ---------------------------------------------------------------------------

export type ResultadoPush = { ok: true; mensagem: string; item: PushItem } | { ok: false; erro: string }

function converterAgenda(local: string): { ok: true; data: Date } | { ok: false; erro: string } {
  const data = fromZonedTime(local, FUSO_PUSH)
  if (Number.isNaN(data.getTime())) return { ok: false, erro: "Data de agendamento inválida." }
  const agora = Date.now()
  if (data.getTime() < agora + AGENDA_MIN_MS) return { ok: false, erro: "O agendamento precisa ser pelo menos 1 minuto no futuro." }
  if (data.getTime() > agora + AGENDA_MAX_DIAS * 86_400_000) return { ok: false, erro: `Agende com até ${AGENDA_MAX_DIAS} dias de antecedência.` }
  return { ok: true, data }
}

export async function salvarPush(
  entrada: Partial<PushEntrada>,
  ator: { id: string; nome: string },
  id?: string,
): Promise<ResultadoPush> {
  const validacao = validarEntradaPush(entrada)
  if (!validacao.ok) return validacao
  const { modo, agendadaPara, ...dados } = validacao.dados

  let quando: Date | null = null
  if (modo === "agendar") {
    const agenda = converterAgenda(agendadaPara as string)
    if (!agenda.ok) return agenda
    quando = agenda.data
  }
  if (modo !== "rascunho" && !pushConfigurado()) {
    return { ok: false, erro: "Configure as chaves VAPID no servidor antes de enviar ou agendar." }
  }
  if (modo === "agora") {
    const alcance = await estimarAlcance(dados)
    if (alcance.aparelhos === 0) return { ok: false, erro: "Nenhum aparelho inscrito é alcançado por este público. Confira a seleção." }
  }

  const campos = {
    ...dados,
    status: modo === "agendar" ? "agendada" : "rascunho",
    agendadaPara: quando,
    erro: null,
    totalAlvos: 0,
    enviados: 0,
    falhas: 0,
    removidos: 0,
    enviadaEm: null,
  }

  let notificacaoId = id
  if (id) {
    const atualizada = await db.pushNotificacao.updateMany({
      where: { id, status: { in: [...STATUS_EDITAVEIS] } },
      data: campos,
    })
    if (atualizada.count !== 1) return { ok: false, erro: "Esta notificação não pode mais ser editada (já foi enviada ou está sendo enviada)." }
  } else {
    const criada = await db.pushNotificacao.create({ data: { ...campos, criadoPorId: ator.id, criadoPorNome: ator.nome }, select: { id: true } })
    notificacaoId = criada.id
  }

  if (modo === "agora" && notificacaoId) {
    if (await reservar(notificacaoId, ["rascunho"])) void executarEnvio(notificacaoId)
  }

  const linha = await db.pushNotificacao.findUnique({ where: { id: notificacaoId as string } })
  if (!linha) return { ok: false, erro: "Não foi possível ler a notificação salva." }
  return {
    ok: true,
    item: paraItem(linha),
    mensagem:
      modo === "agora" ? "Enviando a notificação agora." : modo === "agendar" ? "Notificação agendada." : "Rascunho salvo.",
  }
}

/** Envia agora uma notificação já salva (rascunho, agendada, cancelada ou que falhou). */
export async function enviarAgoraPush(id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (!pushConfigurado()) return { ok: false, erro: "Configure as chaves VAPID no servidor antes de enviar." }
  const n = await db.pushNotificacao.findUnique({ where: { id } })
  if (!n) return { ok: false, erro: "Notificação não encontrada." }
  const alcance = await estimarAlcance({
    publico: n.publico === "papeis" || n.publico === "usuarios" ? n.publico : "todos",
    papeis: n.papeis.filter(isUserRole),
    usuarioIds: n.usuarioIds,
    somenteInstalados: n.somenteInstalados,
  })
  if (alcance.aparelhos === 0) return { ok: false, erro: "Nenhum aparelho inscrito é alcançado por este público." }
  if (!(await reservar(id, STATUS_EDITAVEIS))) return { ok: false, erro: "Esta notificação não pode ser enviada agora (já foi enviada ou está em envio)." }
  void executarEnvio(id)
  return { ok: true }
}

export async function cancelarPush(id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const r = await db.pushNotificacao.updateMany({
    where: { id, status: "agendada" },
    data: { status: "cancelada", ultimaVarreduraEm: new Date() },
  })
  return r.count === 1 ? { ok: true } : { ok: false, erro: "Só notificações agendadas podem ser canceladas." }
}

export async function excluirPush(id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const r = await db.pushNotificacao.deleteMany({ where: { id, status: { not: "enviando" } } })
  return r.count === 1 ? { ok: true } : { ok: false, erro: "Não foi possível excluir (a notificação está em envio ou não existe mais)." }
}

/** Teste: manda a notificação só para os aparelhos do próprio usuário, sem criar registro. */
export async function enviarTestePush(
  userId: string,
  entrada: Partial<PushEntrada>,
): Promise<{ ok: true; enviados: number; falhas: number } | { ok: false; erro: string }> {
  if (!pushConfigurado()) return { ok: false, erro: "Configure as chaves VAPID no servidor antes de testar." }
  const validacao = validarEntradaPush({ ...entrada, modo: "rascunho", publico: "todos" })
  if (!validacao.ok) return validacao
  const alvos = await db.pushAssinatura.findMany({ where: { userId }, select: { id: true, endpoint: true, p256dh: true, auth: true } })
  if (alvos.length === 0) {
    return { ok: false, erro: "Este usuário ainda não tem aparelho inscrito. Ative as notificações neste aparelho primeiro." }
  }
  const { titulo, corpo, url, imagem, urgente } = validacao.dados
  const contagem = await enviarParaAlvos(alvos, montarPayload({ id: "teste", titulo, corpo, url, imagem, urgente }, `teste-${Date.now()}`), urgente)
  if (contagem.enviados === 0) return { ok: false, erro: `O teste não chegou a nenhum aparelho. ${textoDoErro(contagem) ?? ""}`.trim() }
  return { ok: true, enviados: contagem.enviados, falhas: contagem.falhas }
}

// ---------------------------------------------------------------------------
// Aparelhos (assinaturas)
// ---------------------------------------------------------------------------

export interface AssinaturaEntrada {
  endpoint: string
  p256dh: string
  auth: string
}

/** Registra (ou transfere para o usuário atual) o aparelho. O endpoint é único por navegador. */
export async function registrarAssinatura(
  userId: string,
  assinatura: AssinaturaEntrada,
  contexto: { userAgent: string | null; instalado: boolean },
): Promise<void> {
  const dados = {
    userId,
    p256dh: assinatura.p256dh,
    auth: assinatura.auth,
    userAgent: contexto.userAgent ? contexto.userAgent.slice(0, 300) : null,
    plataforma: plataformaDoUserAgent(contexto.userAgent),
    instalado: contexto.instalado,
    falhas: 0,
  }
  await db.pushAssinatura.upsert({
    where: { endpoint: assinatura.endpoint },
    create: { endpoint: assinatura.endpoint, ...dados },
    update: dados,
  })
}

export async function removerAssinatura(userId: string, endpoint: string): Promise<void> {
  await db.pushAssinatura.deleteMany({ where: { userId, endpoint } })
}

export async function assinaturaRegistrada(userId: string, endpoint: string): Promise<boolean> {
  return (await db.pushAssinatura.count({ where: { userId, endpoint } })) > 0
}

/** Navegador trocou o endpoint (evento `pushsubscriptionchange`): apaga o antigo e grava o novo. */
export async function renovarAssinatura(
  userId: string,
  antigo: string | null,
  nova: AssinaturaEntrada,
  contexto: { userAgent: string | null; instalado: boolean },
): Promise<void> {
  if (antigo && antigo !== nova.endpoint) await db.pushAssinatura.deleteMany({ where: { userId, endpoint: antigo } })
  await registrarAssinatura(userId, nova, contexto)
}

// ---------------------------------------------------------------------------
// Rotina periódica (timer interno + /api/cron)
// ---------------------------------------------------------------------------

let manutencaoEmAndamento = false

export interface ResultadoManutencaoPush {
  enviadas: number
  interrompidas: number
  ignorado?: boolean
}

/** Dispara as agendadas que já chegaram na hora e encerra envios que ficaram sem sinal de vida. */
export async function manutencaoPush(): Promise<ResultadoManutencaoPush> {
  if (manutencaoEmAndamento) return { enviadas: 0, interrompidas: 0, ignorado: true }
  manutencaoEmAndamento = true
  try {
    const agora = new Date()

    // Envio que parou no meio (processo caiu): vira falha. Não reenvia sozinho para não duplicar aviso.
    const paradas = await db.pushNotificacao.updateMany({
      where: { status: "enviando", ultimaVarreduraEm: { lt: new Date(agora.getTime() - SEM_SINAL_MS) } },
      data: { status: "falha", erro: "Interrompido antes de terminar (o app reiniciou ou parou de responder). Confira os envios e reenvie se precisar." },
    })

    const devidas = await db.pushNotificacao.findMany({
      where: { status: "agendada", agendadaPara: { lte: agora } },
      orderBy: { agendadaPara: "asc" },
      take: MAX_AGENDADAS_POR_VARREDURA,
      select: { id: true },
    })

    let enviadas = 0
    for (const { id } of devidas) {
      if (await reservar(id, ["agendada"])) {
        void executarEnvio(id)
        enviadas += 1
      }
    }
    return { enviadas, interrompidas: paradas.count }
  } finally {
    manutencaoEmAndamento = false
  }
}
