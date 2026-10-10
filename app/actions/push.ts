"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"

import { endpointPushValido, type AparelhoPush, type PublicoEntrada, type PushEntrada, type PushItem, type ResumoPush, type UsuarioPush } from "@/lib/push"
import { assertRoot, assertUsuario } from "@/lib/session"
import { recordAppLog } from "@/services/app-logs"
import {
  assinaturaRegistrada,
  cancelarPush,
  chavePublicaPush,
  enviarAgoraPush,
  enviarTestePush,
  estimarAlcance,
  excluirPush,
  gerarChavesVapid,
  listarAparelhos,
  listarPush,
  listarUsuariosComAparelho,
  pushConfigurado,
  registrarAssinatura,
  removerAssinatura,
  resumoPush,
  salvarPush,
} from "@/services/push"

type Falha = { ok: false; message: string }

async function falha(mensagem: string, error: unknown): Promise<Falha> {
  await recordAppLog({ origem: "push", mensagem, detalhes: error }).catch(() => undefined)
  return { ok: false, message: `${mensagem} Confira se a migration mais recente (push) foi aplicada.` }
}

// ---------------------------------------------------------------------------
// Aparelho do usuário logado (qualquer nível): pedir permissão e registrar
// ---------------------------------------------------------------------------

/** Chave pública VAPID, lida em tempo de execução. `null` = o servidor ainda não está configurado. */
export async function chavePublicaPushAction(): Promise<string | null> {
  await assertUsuario()
  return pushConfigurado() ? chavePublicaPush() : null
}

export async function registrarPushAction(input: {
  endpoint: string
  keys: { p256dh: string; auth: string }
  instalado: boolean
}): Promise<{ ok: true } | Falha> {
  const usuario = await assertUsuario()
  if (!endpointPushValido(input?.endpoint) || typeof input.keys?.p256dh !== "string" || typeof input.keys?.auth !== "string") {
    return { ok: false, message: "Assinatura de notificações inválida." }
  }
  try {
    const ua = (await headers()).get("user-agent")
    await registrarAssinatura(
      usuario.id,
      { endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth },
      { userAgent: ua, instalado: input.instalado === true },
    )
    return { ok: true }
  } catch (error) {
    return falha("Não foi possível registrar este aparelho.", error)
  }
}

export async function removerPushAction(endpoint: string): Promise<{ ok: true } | Falha> {
  const usuario = await assertUsuario()
  if (typeof endpoint !== "string" || !endpoint) return { ok: false, message: "Aparelho inválido." }
  try {
    await removerAssinatura(usuario.id, endpoint)
    return { ok: true }
  } catch (error) {
    return falha("Não foi possível desativar as notificações.", error)
  }
}

/** O endereço deste navegador está registrado no servidor para o usuário atual? */
export async function assinaturaRegistradaAction(endpoint: string): Promise<boolean> {
  const usuario = await assertUsuario()
  if (typeof endpoint !== "string" || !endpoint) return false
  return assinaturaRegistrada(usuario.id, endpoint).catch(() => false)
}

// ---------------------------------------------------------------------------
// Tela do Root
// ---------------------------------------------------------------------------

export interface PainelPush {
  resumo: ResumoPush
  itens: PushItem[]
  aparelhos: AparelhoPush[]
  usuarios: UsuarioPush[]
}

/** Atualização da tela (também usada no acompanhamento de envios em andamento). */
export async function carregarPainelPushAction(): Promise<PainelPush | null> {
  await assertRoot()
  try {
    const [resumo, itens, aparelhos, usuarios] = await Promise.all([resumoPush(), listarPush(), listarAparelhos(), listarUsuariosComAparelho()])
    return { resumo, itens, aparelhos, usuarios }
  } catch {
    return null
  }
}

export async function salvarPushAction(
  input: Partial<PushEntrada>,
  id?: string,
): Promise<{ ok: true; message: string; item: PushItem } | Falha> {
  const root = await assertRoot()
  try {
    const resultado = await salvarPush(input, { id: root.id, nome: root.nome }, id)
    if (!resultado.ok) return { ok: false, message: resultado.erro }
    revalidatePath("/push")
    return { ok: true, message: resultado.mensagem, item: resultado.item }
  } catch (error) {
    return falha("Não foi possível salvar a notificação.", error)
  }
}

export async function enviarAgoraPushAction(id: string): Promise<{ ok: true; message: string } | Falha> {
  await assertRoot()
  try {
    const resultado = await enviarAgoraPush(id)
    if (!resultado.ok) return { ok: false, message: resultado.erro }
    revalidatePath("/push")
    return { ok: true, message: "Enviando a notificação agora." }
  } catch (error) {
    return falha("Não foi possível enviar a notificação.", error)
  }
}

export async function cancelarPushAction(id: string): Promise<{ ok: true; message: string } | Falha> {
  await assertRoot()
  try {
    const resultado = await cancelarPush(id)
    if (!resultado.ok) return { ok: false, message: resultado.erro }
    revalidatePath("/push")
    return { ok: true, message: "Agendamento cancelado." }
  } catch (error) {
    return falha("Não foi possível cancelar o agendamento.", error)
  }
}

export async function excluirPushAction(id: string): Promise<{ ok: true; message: string } | Falha> {
  await assertRoot()
  try {
    const resultado = await excluirPush(id)
    if (!resultado.ok) return { ok: false, message: resultado.erro }
    revalidatePath("/push")
    return { ok: true, message: "Notificação excluída." }
  } catch (error) {
    return falha("Não foi possível excluir a notificação.", error)
  }
}

export async function estimarAlcancePushAction(publico: PublicoEntrada): Promise<{ aparelhos: number; usuarios: number } | null> {
  await assertRoot()
  try {
    return await estimarAlcance({
      publico: publico?.publico === "papeis" || publico?.publico === "usuarios" ? publico.publico : "todos",
      papeis: Array.isArray(publico?.papeis) ? publico.papeis : [],
      usuarioIds: Array.isArray(publico?.usuarioIds) ? publico.usuarioIds : [],
      somenteInstalados: publico?.somenteInstalados !== false,
    })
  } catch {
    return null
  }
}

/** Envia a notificação só para os aparelhos do Root que está logado (sem criar registro). */
export async function enviarTestePushAction(input: Partial<PushEntrada>): Promise<{ ok: true; message: string } | Falha> {
  const root = await assertRoot()
  try {
    const resultado = await enviarTestePush(root.id, input)
    if (!resultado.ok) return { ok: false, message: resultado.erro }
    return { ok: true, message: `Teste enviado para ${resultado.enviados} ${resultado.enviados === 1 ? "aparelho" : "aparelhos"}.` }
  } catch (error) {
    return falha("Não foi possível enviar o teste.", error)
  }
}

/**
 * Gera um par de chaves VAPID para o Root copiar para o ambiente do servidor. Só funciona enquanto
 * as chaves ainda NÃO estão configuradas (trocar chaves em uso invalidaria todos os aparelhos).
 */
export async function gerarChavesVapidAction(): Promise<{ ok: true; publicKey: string; privateKey: string } | Falha> {
  await assertRoot()
  if (pushConfigurado()) return { ok: false, message: "As chaves já estão configuradas. Trocá-las desativaria as notificações de todos os aparelhos." }
  const chaves = gerarChavesVapid()
  return { ok: true, ...chaves }
}
