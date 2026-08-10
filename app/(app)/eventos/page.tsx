import { EventsFeed } from "@/components/features/events/events-feed"
import { PageHeader } from "@/components/shared/page-header"
import { listEvents } from "@/services/events"

export const metadata = {
  title: "Eventos",
}

export default async function EventosPage() {
  const eventos = await listEvents(400)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Eventos"
        descricao="Linha do tempo unificada de envios, respostas e qualificações."
      />
      <EventsFeed eventos={eventos} />
    </div>
  )
}
