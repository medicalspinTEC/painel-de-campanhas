import { PushManager } from "@/components/features/push/push-manager"
import { PageHeader } from "@/components/shared/page-header"
import { requireRoot } from "@/lib/session"
import { listarAparelhos, listarPush, listarUsuariosComAparelho, resumoPush } from "@/services/push"

export const metadata = {
  title: "Notificações push | Painel de Campanhas WhatsApp",
}

export const dynamic = "force-dynamic"

/** Exclusivo do Root: avisos externos (com o app fechado) para quem instalou o PWA. */
export default async function PushPage() {
  await requireRoot()
  const painel = await Promise.all([resumoPush(), listarPush(), listarAparelhos(), listarUsuariosComAparelho()]).catch(() => null)

  if (!painel) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader titulo="Notificações push" />
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          Não foi possível ler as notificações. Confira se a migration mais recente (push) foi aplicada e se o <code>prisma generate</code> rodou.
        </p>
      </div>
    )
  }
  const [resumo, itens, aparelhos, usuarios] = painel

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Notificações push"
        descricao="Envie, agende, edite e cancele avisos que chegam no aparelho de quem instalou o app, mesmo com ele fechado. Não precisa mexer no código."
      />
      <PushManager inicial={{ resumo, itens, aparelhos, usuarios }} />
    </div>
  )
}
