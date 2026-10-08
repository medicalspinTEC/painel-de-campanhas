import { getCurrentUser } from "@/lib/session"
import { getUserFoto } from "@/services/users"

/**
 * GET /api/usuarios/:id/foto
 *
 * Foto de perfil de um usuário, para quem está logado e pode vê-lo (mesma instância; o Root
 * também vê a dos administradores). A URL leva `?v=<momento da troca>`, então o navegador
 * pode guardar em cache "para sempre" — ao trocar a foto, a URL muda.
 *
 *   200  imagem
 *   401  sem sessão
 *   404  sem foto (o cliente mostra as iniciais)
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ator = await getCurrentUser()
  if (!ator) return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } })

  const { id } = await params
  const foto = await getUserFoto(id, ator)
  if (!foto) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } })

  return new Response(new Uint8Array(foto.dados), {
    headers: {
      "Content-Type": foto.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
