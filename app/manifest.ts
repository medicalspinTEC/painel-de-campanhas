import type { MetadataRoute } from "next"

/**
 * Manifest do PWA: é ele que permite "Adicionar à tela inicial" no celular e abrir
 * o painel em tela cheia, como um aplicativo.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Medical Spin",
    short_name: "Medical Spin",
    description: "Painel de campanhas, chat e leads no WhatsApp.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Chat", short_name: "Chat", url: "/chat", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  }
}
