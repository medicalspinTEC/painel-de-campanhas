"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  LayoutDashboard,
  LogOut,
  CalendarRange,
  Plug,
  Megaphone,
  Settings,
  Target,
  TriangleAlert,
  Users,
  Zap,
} from "lucide-react"

import { logoutAction } from "@/app/actions/auth"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

const navPrincipal = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Leads", url: "/leads", icon: Users },
  { title: "Campanhas", url: "/campanhas", icon: Megaphone },
  { title: "Segmentação", url: "/segmentacao", icon: Target },
]

const navOperacao = [
  { title: "Eventos", url: "/eventos", icon: CalendarRange },
  { title: "Logs", url: "/logs", icon: TriangleAlert },
  { title: "Relatórios", url: "/relatorios", icon: BarChart3 },
]

const navSistema = [
  { title: "Integrações", url: "/integracoes", icon: Plug },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
]

interface AppSidebarProps {
  instanceName?: string
  instanceState?: string
  profileImageUrl?: string | null
}

function getStatusMeta(state?: string) {
  const normalizedState = state?.toLowerCase()

  switch (normalizedState) {
    case "open":
    case "connected":
    case "online":
      return {
        label: "Conectado",
        className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      }
    case "connecting":
    case "connectando":
      return {
        label: "Conectando",
        className: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      }
    case "close":
    case "closed":
    case "disconnected":
    case "offline":
      return {
        label: "Desconectado",
        className: "border-muted-foreground/30 bg-muted text-muted-foreground",
      }
    default:
      return {
        label: "Indefinido",
        className: "border-muted-foreground/30 bg-muted text-muted-foreground",
      }
  }
}

export function AppSidebar({ instanceName, instanceState, profileImageUrl }: AppSidebarProps) {
  const pathname = usePathname()

  const isActive = (url: string) => pathname === url || pathname.startsWith(`${url}/`)
  const displayName = instanceName?.trim() || "Campanhas"
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "C"
  const statusMeta = getStatusMeta(instanceState)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1.5 group-data-[collapsible=icon]:px-0">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg text-primary-foreground">
            <img src="/icon-light-32x32.png" alt="" />
          </div>
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold leading-tight">Medical Spin</span>
            <span className="truncate text-xs text-muted-foreground leading-tight">Follow-up WhatsApp</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Gestão</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navPrincipal.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    isActive={isActive(item.url)}
                    title={item.title}
                    render={
                      <Link href={item.url}>
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </Link>
                    }
                  />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Acompanhamento</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navOperacao.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    isActive={isActive(item.url)}
                    title={item.title}
                    render={
                      <Link href={item.url}>
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </Link>
                    }
                  />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Sistema</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navSistema.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    isActive={isActive(item.url)}
                    title={item.title}
                    render={
                      <Link href={item.url}>
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </Link>
                    }
                  />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex flex-col gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-3 group-data-[collapsible=icon]:hidden">
          <div className="flex items-start gap-2.5">
            <Avatar size="sm" className="shrink-0">
              {profileImageUrl ? (
                <AvatarImage src={profileImageUrl} alt={displayName} />
              ) : (
                <AvatarFallback className="text-[10px] font-semibold">{initials}</AvatarFallback>
              )}
            </Avatar>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium">{displayName}</span>
                <Badge variant="outline" className={statusMeta.className}>
                  {statusMeta.label}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                Instância Evolution • status {instanceState ?? "indefinido"}
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            {instanceState?.toLowerCase() === "open"
              ? "A instância está conectada e pronta para disparos."
              : `Aguardando conexão da instância ${process.env.EVOLUTION_INSTANCE_NAME}.`}
          </p>
        </div>

        <SidebarMenu>
          <SidebarMenuItem>
            <form action={logoutAction} className="w-full">
              <SidebarMenuButton
                type="submit"
                title="Sair"
                className="text-muted-foreground hover:text-foreground"
              >
                <LogOut className="size-4" />
                <span>Sair</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
