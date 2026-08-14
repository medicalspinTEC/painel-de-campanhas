import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { GlobalSearch, type SearchItem } from "@/components/layout/global-search"
import { NotificationBell } from "@/components/layout/notification-bell"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import type { EventRow } from "@/services/events"

export function AppHeader({
  leads,
  campanhas,
  notificacoes,
}: {
  leads: SearchItem[]
  campanhas: SearchItem[]
  notificacoes: EventRow[]
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-sm">
      <SidebarTrigger />
      <div className="flex flex-1 items-center gap-2">
        <GlobalSearch leads={leads} campanhas={campanhas} />
      </div>
      <div className="flex items-center gap-1">
        <NotificationBell notificacoes={notificacoes} />
        <ThemeToggle />
      </div>
    </header>
  )
}
