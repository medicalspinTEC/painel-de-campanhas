/** @type {import('next').NextConfig} */
const nextConfig = {
  // Gera um servidor autocontido em `.next/standalone`, ideal para imagens
  // Docker pequenas (copiamos apenas o necessário no estágio final).
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
