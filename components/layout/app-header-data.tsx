import { AppHeader } from "@/components/layout/app-header"
import { podeAcessar, SECOES } from "@/lib/permissoes"
import { getCurrentUser } from "@/lib/session"
import { listCampaignsForSearch } from "@/services/campaigns"
import { listEvents } from "@/services/events"
import { listLeadsForSearch } from "@/services/leads"
import { getAssistentePluginAtivo } from "@/services/settings"

/**
 * Busca os dados do cabeçalho (busca global + notificações) separado do
 * restante do layout. Envolvido em `<Suspense>` no layout, o Next pode
 * transmitir o conteúdo da página assim que ela estiver pronta, sem esperar
 * por estas três consultas em toda navegação.
 */
export async function AppHeaderData() {
  const usuario = await getCurrentUser()
  const podeLeads = usuario ? podeAcessar(usuario, "leads") : false
  const podeCampanhas = usuario ? podeAcessar(usuario, "campanhas") : false
  const podeEventos = usuario ? podeAcessar(usuario, "eventos") : false
  const podeAssistente = usuario ? podeAcessar(usuario, "assistente") : false

  // Só busca (e só entrega ao navegador) o que o usuário tem permissão de ver.
  const [leads, campanhas, notificacoes, assistenteAtivo] = await Promise.all([
    podeLeads ? listLeadsForSearch(40) : Promise.resolve([]),
    podeCampanhas ? listCampaignsForSearch(40) : Promise.resolve([]),
    podeEventos ? listEvents(30) : Promise.resolve([]),
    podeAssistente ? getAssistentePluginAtivo() : Promise.resolve(false),
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
      assistenteAtivo={assistenteAtivo}
      mostrarNotificacoes={podeEventos}
      urlsPermitidas={usuario ? SECOES.filter((s) => podeAcessar(usuario, s.key)).map((s) => s.url) : []}
    />
  )
}
