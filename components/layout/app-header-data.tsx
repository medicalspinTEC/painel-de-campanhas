import { AppHeader } from "@/components/layout/app-header"
import { listCampaignsForSearch } from "@/services/campaigns"
import { listEvents } from "@/services/events"
import { listLeadsForSearch } from "@/services/leads"

/**
 * Busca os dados do cabeçalho (busca global + notificações) separado do
 * restante do layout. Envolvido em `<Suspense>` no layout, o Next pode
 * transmitir o conteúdo da página assim que ela estiver pronta, sem esperar
 * por estas três consultas em toda navegação.
 */
export async function AppHeaderData() {
  const [leads, campanhas, notificacoes] = await Promise.all([
    listLeadsForSearch(40),
    listCampaignsForSearch(40),
    listEvents(30),
  ])

  return (
    <AppHeader
      leads={leads.map((l) => ({
        id: l.id,
        nome: l.nome,
        detalhe: l.produto,
        href: `/leads/${l.id}`,
      }))}
      campanhas={campanhas.map((c) => ({
        id: c.id,
        nome: c.nome,
        detalhe: `${c.totalLeads} leads`,
        href: `/campanhas/${c.id}`,
      }))}
      notificacoes={notificacoes}
    />
  )
}
