import { prisma } from "@/lib/prisma"
import { getLeadProfilePicture } from "@/services/evolution"

/**
 * GET /api/leads/:id/foto
 *
 * Foto de perfil do WhatsApp do lead (Evolution API, todas as instâncias
 * cadastradas). A imagem passa pelo servidor para não expor a apikey e porque
 * as URLs do WhatsApp expiram.
 *
 *   200  imagem
 *   404  existe no WhatsApp mas sem foto visível -> o cliente tenta de novo
 *   410  número fora do WhatsApp -> não tentar até o lead ser editado
 *   502  falha temporária -> o cliente tenta de novo
 */
const SEM_CACHE = { "Cache-Control": "no-store" }

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, telefone: true, atualizadoEm: true } })
  if (!lead) return new Response(null, { status: 410, headers: SEM_CACHE })

  const resultado = await getLeadProfilePicture(lead)
  if (resultado.status === "nao_existe") return new Response(null, { status: 410, headers: SEM_CACHE })
  if (resultado.status === "sem_foto") return new Response(null, { status: 404, headers: SEM_CACHE })
  if (resultado.status !== "foto" || !resultado.url) return new Response(null, { status: 502, headers: SEM_CACHE })

  try {
    const imagem = await fetch(resultado.url, { cache: "no-store", signal: AbortSignal.timeout(8000) })
    const tipo = imagem.headers.get("content-type") ?? ""
    if (!imagem.ok || !tipo.startsWith("image/")) return new Response(null, { status: 502, headers: SEM_CACHE })

    return new Response(imagem.body, {
      headers: { "Content-Type": tipo, "Cache-Control": "private, max-age=1800" },
    })
  } catch {
    return new Response(null, { status: 502, headers: SEM_CACHE })
  }
}
