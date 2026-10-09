/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  experimental: {
    // Guarda no navegador, por 20 s, as páginas já visitadas: voltar para uma aba do menu é
    // instantâneo. Ações que alteram dados (revalidatePath/router.refresh) limpam esse cache.
    staleTimes: { dynamic: 20 },

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