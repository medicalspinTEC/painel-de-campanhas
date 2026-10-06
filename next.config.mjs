/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  experimental: {
    // Mensagens de voz, imagens e arquivos do chat sobem por Server Action (o padrão do Next é 1 MB).
    // Os limites reais são aplicados em lib/audio-storage.ts (8 MB) e lib/arquivo-storage.ts (16 MB).
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },

  typescript: {
    ignoreBuildErrors: true,
  },

  images: {
    unoptimized: true,
  },
}

export default nextConfig