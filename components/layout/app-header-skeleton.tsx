import { SidebarTrigger } from "@/components/ui/sidebar"

/**
 * Mesma altura/estrutura do `AppHeader` real, sem os dados ainda resolvidos.
 * Mantém o layout estável enquanto `AppHeaderData` busca leads/campanhas/
 * notificações em segundo plano.
 */
export function AppHeaderSkeleton() {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-sm">
      <SidebarTrigger />
      <div className="flex flex-1 items-center gap-2">
        <div className="h-9 w-full max-w-sm animate-pulse rounded-md bg-muted" />
      </div>
      <div className="flex items-center gap-1">
        <div className="size-8 animate-pulse rounded-md bg-muted" />
        <div className="size-8 animate-pulse rounded-md bg-muted" />
      </div>
    </header>
  )
}
