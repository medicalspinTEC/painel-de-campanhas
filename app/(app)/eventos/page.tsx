import { EventsFeed } from "@/components/features/events/events-feed"
import { PageHeader } from "@/components/shared/page-header"
import { listEvents } from "@/services/events"
import { requireSecao } from "@/lib/session"

export const metadata = {
  title: "Eventos | Painel de Campanhas WhatsApp",
}

export default async function EventosPage() {
  await requireSecao("eventos")
  const eventos = await listEvents(400)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Eventos"
        descricao="Linha do tempo unificada de envios e respostas."
      />
      <EventsFeed eventos={eventos} />
    </div>
  )
}
