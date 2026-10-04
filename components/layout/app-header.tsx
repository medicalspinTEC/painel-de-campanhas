import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { GlobalSearch, type SearchItem } from "@/components/layout/global-search"
import { NotificationBell } from "@/components/layout/notification-bell"
import { AssistantShortcut } from "@/components/layout/assistant-shortcut"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import type { EventRow } from "@/services/events"

export function AppHeader({
  leads,
  campanhas,
  notificacoes,
  assistenteAtivo,
  mostrarNotificacoes = true,
  urlsPermitidas,
}: {
  leads: SearchItem[]
  campanhas: SearchItem[]
  notificacoes: EventRow[]
  assistenteAtivo: boolean
  mostrarNotificacoes?: boolean
  urlsPermitidas?: string[]
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-sm">
      <SidebarTrigger />
      <div className="flex flex-1 items-center gap-2">
        <GlobalSearch leads={leads} campanhas={campanhas} urlsPermitidas={urlsPermitidas} />
      </div>
      <div className="flex items-center gap-1">
        {assistenteAtivo ? <AssistantShortcut /> : null}
        {mostrarNotificacoes ? <NotificationBell notificacoes={notificacoes} /> : null}
        <ThemeToggle />
      </div>
    </header>
  )
}
