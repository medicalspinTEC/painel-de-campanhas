"use server"

import { revalidatePath } from "next/cache"

import { validarAgenda } from "@/lib/backup/agenda"
import { normalizarSecoes } from "@/lib/backup/secoes"
import { assertSecao } from "@/lib/session"
import { recordAppLog } from "@/services/app-logs"
import {
  enviarTesteBackup,
  iniciarBackupManual,
  listarBackups,
  retentarBackup,
  salvarConfigBackup,
  segredoSalvoBackup,
  type BackupRow,
  type ConfigBackup,
} from "@/services/backup"
import { validarUrlWebhook } from "@/services/nocode-webhook-execucoes"

/** Seção de permissão: o backup fica dentro de Configurações, então segue o acesso dela (ajuste a chave se a sua for outra). */
const SECAO = "configuracoes"

type Resultado<T = object> = ({ ok: true; message: string } & T) | { ok: false; message: string }

const LIMITE_SEGREDO = 200

async function falha(mensagem: string, error: unknown): Promise<{ ok: false; message: string }> {
  await recordAppLog({ origem: "backup", mensagem, detalhes: error })
  return { ok: false, message: `${mensagem} Confira se a migration mais recente foi aplicada.` }
}

/** `undefined` mantém o segredo atual; `null` remove; texto define. */
function lerSegredo(valor: unknown): { ok: true; segredo: string | null | undefined } | { ok: false; message: string } {
  if (valor === null) return { ok: true, segredo: null }
  if (typeof valor === "string" && valor.trim()) {
    const segredo = valor.trim()
    if (segredo.length > LIMITE_SEGREDO) return { ok: false, message: `O segredo pode ter no máximo ${LIMITE_SEGREDO} caracteres.` }
    return { ok: true, segredo }
  }
  return { ok: true, segredo: undefined }
}

/** Salva o webhook, as seções escolhidas e a agenda do backup automático. */
export async function salvarConfigBackupAction(input: {
  url: string
  segredo?: string | null
  secoes: string[]
  auto: { ativo: boolean; modo: string; intervaloHoras: number; horario: string; diaSemana: number }
}): Promise<Resultado<{ config: ConfigBackup }>> {
  await assertSecao(SECAO)

  const secoes = normalizarSecoes(input?.secoes)
  const url = String(input?.url ?? "").trim()
  const ativo = input?.auto?.ativo === true

  let urlFinal = ""
  if (url || ativo) {
    const validacao = validarUrlWebhook(url)
    if (!validacao.ok) return { ok: false, message: validacao.erro }
    urlFinal = validacao.url
  }
  if (ativo && secoes.length === 0) {
    return { ok: false, message: "Selecione ao menos uma seção para o backup automático." }
  }

  const agenda = validarAgenda(input?.auto ?? {})
  if (!agenda.ok) return { ok: false, message: agenda.erro }

  const segredo = lerSegredo(input.segredo)
  if (!segredo.ok) return segredo

  try {
    const config = await salvarConfigBackup({
      url: urlFinal,
      segredo: segredo.segredo,
      secoes,
      auto: { ...agenda.agenda, ativo },
    })
    revalidatePath("/configuracoes")
    return { ok: true, message: ativo ? "Configuração salva. Backup automático ativado." : "Configuração salva.", config }
  } catch (error) {
    return falha("Não foi possível salvar a configuração do backup.", error)
  }
}

/** Envia uma mensagem de teste (sem dados do app) para a URL informada. */
export async function testarWebhookBackupAction(input: {
  url: string
  segredo?: string | null
  secoes?: string[]
}): Promise<Resultado> {
  await assertSecao(SECAO)
  const validacao = validarUrlWebhook(input?.url)
  if (!validacao.ok) return { ok: false, message: validacao.erro }

  try {
    // Segredo em branco no formulário = usar o já salvo (ele nunca é devolvido à tela).
    const segredo =
      typeof input.segredo === "string" && input.segredo.trim()
        ? input.segredo.trim()
        : input.segredo === null
          ? null
          : await segredoSalvoBackup()
    return await enviarTesteBackup({ url: validacao.url, segredo }, normalizarSecoes(input.secoes))
  } catch (error) {
    return falha("Não foi possível enviar o teste.", error)
  }
}

/** Backup manual: começa em segundo plano; a tela acompanha o andamento pelo histórico. */
export async function iniciarBackupManualAction(input: { secoes: string[] }): Promise<Resultado<{ id: string; backups: BackupRow[] }>> {
  await assertSecao(SECAO)
  try {
    const inicio = await iniciarBackupManual(input?.secoes)
    if (!inicio.ok) return { ok: false, message: inicio.erro }
    revalidatePath("/configuracoes")
    return { ok: true, message: "Backup iniciado.", id: inicio.id, backups: await listarBackups() }
  } catch (error) {
    return falha("Não foi possível iniciar o backup.", error)
  }
}

export async function retentarBackupAction(id: string): Promise<Resultado<{ backups: BackupRow[] }>> {
  await assertSecao(SECAO)
  if (typeof id !== "string" || !id) return { ok: false, message: "Backup inválido." }
  try {
    const resultado = await retentarBackup(id)
    if (!resultado.ok) return { ok: false, message: resultado.erro ?? "Não foi possível tentar de novo." }
    return { ok: true, message: "Tentando enviar de novo.", backups: await listarBackups() }
  } catch (error) {
    return falha("Não foi possível tentar de novo.", error)
  }
}

/** Usada pela tela para acompanhar o andamento enquanto há backup em curso. */
export async function listarBackupsAction(): Promise<BackupRow[] | null> {
  await assertSecao(SECAO)
  try {
    return await listarBackups()
  } catch {
    return null
  }
}
