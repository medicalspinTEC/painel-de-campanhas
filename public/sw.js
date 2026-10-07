/*
 * Service worker do PWA.
 *
 * Regras (o painel é autenticado e em tempo real, então NADA de dados é cacheado):
 *  - Navegações: sempre rede; se estiver offline, mostra /offline.html.
 *  - /_next/static e ícones: cache-first (arquivos imutáveis, com hash no nome).
 *  - /api, Server Actions (POST) e qualquer outra requisição: passam direto pela rede.
 */
const VERSION = "v1"
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

// Toque numa notificação: abre/foca o app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || "/chat"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUninstalled: false }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(target).catch(() => {})
          return c.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
