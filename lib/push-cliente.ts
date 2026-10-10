"use client"

/**
 * Ajudantes de notificações push no NAVEGADOR: checar suporte, pedir permissão e registrar o
 * aparelho no servidor. Usado pelo aviso do app (`PushAtivador`) e pelo cartão da conta.
 */
import { chavePublicaPushAction, registrarPushAction, removerPushAction } from "@/app/actions/push"

export type EstadoPush = "nao-suportado" | "ios-instalar" | "bloqueado" | "pedir" | "ativo" | "inativo" | "sem-servidor"

/** Só em produção: é quando o service worker é registrado (ver `PwaRegister`). */
export function pushDisponivelNoAmbiente(): boolean {
  return process.env.NODE_ENV === "production"
}

export function suportaPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

export function appInstalado(): boolean {
  if (typeof window === "undefined") return false
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches
  return Boolean(standalone || (navigator as Navigator & { standalone?: boolean }).standalone)
}

export function ehIOS(): boolean {
  if (typeof navigator === "undefined") return false
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
}

function chaveParaBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const preenchimento = "=".repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + preenchimento).replace(/-/g, "+").replace(/_/g, "/")
  const bruto = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(bruto.length))
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i)
  return bytes
}

function iguais(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false
  const x = new Uint8Array(a)
  if (x.length !== b.length) return false
  return x.every((valor, i) => valor === b[i])
}

async function registroDoSw(): Promise<ServiceWorkerRegistration | null> {
  // `ready` nunca resolve se não houver service worker: não espera para sempre.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
  ])
}

/** Estado atual deste aparelho/navegador. */
export async function lerEstadoPush(): Promise<{ estado: EstadoPush; endpoint: string | null }> {
  if (!suportaPush()) {
    return { estado: ehIOS() && !appInstalado() ? "ios-instalar" : "nao-suportado", endpoint: null }
  }
  const chave = await chavePublicaPushAction().catch(() => null)
  if (!chave) return { estado: "sem-servidor", endpoint: null }
  if (Notification.permission === "denied") return { estado: "bloqueado", endpoint: null }

  const registro = await registroDoSw()
  const assinatura = registro ? await registro.pushManager.getSubscription() : null
  if (Notification.permission === "granted" && assinatura) return { estado: "ativo", endpoint: assinatura.endpoint }
  return { estado: Notification.permission === "granted" ? "inativo" : "pedir", endpoint: null }
}

/**
 * Garante a assinatura (cria ou renova) e registra o aparelho no servidor. Não pede permissão:
 * quem chama já checou que ela foi concedida.
 */
export async function assinarEsteAparelho(): Promise<{ ok: true; endpoint: string } | { ok: false; message: string }> {
  const chave = await chavePublicaPushAction()
  if (!chave) return { ok: false, message: "As notificações ainda não foram configuradas no servidor." }

  const registro = await registroDoSw()
  if (!registro) return { ok: false, message: "O app ainda não está pronto para notificações. Recarregue a página e tente de novo." }

  const chaveBytes = chaveParaBytes(chave)
  let assinatura = await registro.pushManager.getSubscription()
  // Chaves do servidor mudaram: a assinatura antiga não serve mais.
  if (assinatura && !iguais(assinatura.options.applicationServerKey, chaveBytes)) {
    await assinatura.unsubscribe().catch(() => undefined)
    assinatura = null
  }
  if (!assinatura) {
    assinatura = await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveBytes })
  }

  const json = assinatura.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, message: "O navegador não devolveu uma assinatura válida." }
  }
  const resultado = await registrarPushAction({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    instalado: appInstalado(),
  })
  if (!resultado.ok) return { ok: false, message: resultado.message }
  return { ok: true, endpoint: json.endpoint }
}

/** Pede a permissão ao usuário (precisa ser chamado a partir de um toque/clique) e registra o aparelho. */
export async function ativarPush(): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!suportaPush()) return { ok: false, message: "Este navegador não permite notificações." }
  const permissao = Notification.permission === "granted" ? "granted" : await Notification.requestPermission()
  if (permissao === "denied") {
    return { ok: false, message: "As notificações estão bloqueadas. Libere nas configurações do navegador/aparelho para este app." }
  }
  if (permissao !== "granted") return { ok: false, message: "Permissão não concedida." }
  try {
    const resultado = await assinarEsteAparelho()
    return resultado.ok ? { ok: true } : resultado
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Não foi possível ativar as notificações." }
  }
}

/** Desativa neste aparelho: cancela a assinatura no navegador e apaga o registro no servidor. */
export async function desativarPush(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const registro = await registroDoSw()
    const assinatura = registro ? await registro.pushManager.getSubscription() : null
    if (assinatura) {
      await removerPushAction(assinatura.endpoint)
      await assinatura.unsubscribe().catch(() => undefined)
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Não foi possível desativar." }
  }
}
