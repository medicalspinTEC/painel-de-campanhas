/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  experimental: {
    // Mensagens de voz do chat sobem por Server Action (o padrão do Next é 1 MB).
    // O limite real de cada áudio é aplicado em lib/audio-storage.ts (8 MB).
    serverActions: {
      bodySizeLimit: '10mb',
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