/*
 * Service worker do PWA.
 *
 * Regras (o painel é autenticado e em tempo real, então NADA de dados é cacheado):
 *  - Navegações: sempre rede; se estiver offline, mostra /offline.html.
 *  - /_next/static e ícones: cache-first (arquivos imutáveis, com hash no nome).
 *  - /api, Server Actions (POST) e qualquer outra requisição: passam direto pela rede.
 */
const VERSION = "v2"
const STATIC_CACHE = `camp-static-${VERSION}`
const OFFLINE_URL = "/offline.html"

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png"])),
  )
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("camp-static-") && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)))
    return
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(STATIC_CACHE).then((c) => c.put(request, copy))
            }
            return res
          }),
      ),
    )
  }
})

// Notificação push (enviada pelo Root em "Notificações push"): aparece mesmo com o app fechado.
self.addEventListener("push", (event) => {
  let dados = {}
  try {
    dados = event.data ? event.data.json() : {}
  } catch (e) {
    dados = { corpo: event.data ? event.data.text() : "" }
  }
  const opcoes = {
    body: dados.corpo || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    requireInteraction: Boolean(dados.urgente),
    data: { url: dados.url || "/", id: dados.id || null },
  }
  // Mesma tag = a notificação nova substitui a anterior (em vez de empilhar).
  if (dados.tag) opcoes.tag = dados.tag
  if (dados.imagem) opcoes.image = dados.imagem
  event.waitUntil(self.registration.showNotification(dados.titulo || "Aviso", opcoes))
})

// O navegador trocou/expirou a assinatura: renova e avisa o servidor (usa o cookie de sessão).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const antiga = event.oldSubscription
        const chave = antiga && antiga.options && antiga.options.applicationServerKey
        const nova =
          event.newSubscription ||
          (chave ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave }) : null)
        if (!nova) return
        await fetch("/api/push/renovar", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ antigo: antiga ? antiga.endpoint : null, assinatura: nova.toJSON() }),
        })
      } catch (e) {
        // Sem sessão ou sem rede: o app registra de novo na próxima vez que for aberto.
      }
    })(),
  )
})

// Toque numa notificação: abre/foca o app (ou abre o link externo).
self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const bruto = (event.notification.data && event.notification.data.url) || "/"
  let alvo
  try {
    alvo = new URL(bruto, self.location.origin)
  } catch (e) {
    alvo = new URL("/", self.location.origin)
  }
  event.waitUntil(
    (async () => {
      if (alvo.origin !== self.location.origin) return self.clients.openWindow(alvo.href)
      const caminho = alvo.pathname + alvo.search + alvo.hash
      const lista = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      for (const c of lista) {
        if ("focus" in c) {
          try {
            await c.navigate(caminho)
          } catch (e) {
            // navegação recusada: só foca
          }
          return c.focus()
        }
      }
      return self.clients.openWindow(caminho)
    })(),
  )
})
