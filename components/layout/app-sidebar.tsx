"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  ClipboardList,
  Columns3,
  Contact,
  MessagesSquare,
  LayoutDashboard,
  LogOut,
  CalendarRange,
  Plug,
  Megaphone,
  Settings,
  ShieldCheck,
  Smartphone,
  UserCog,
  Target,
  TriangleAlert,
  Users,
  Zap,
  Bot,
  SquareKanban,
  Workflow,
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
  { title: "Kanban", url: "/kanban", icon: SquareKanban },
  { title: "Chat", url: "/chat", icon: MessagesSquare },
  { title: "Assistente", url: "/assistente", icon: Bot }, 
  { title: "Campanhas", url: "/campanhas", icon: Megaphone },
  { title: "Segmentação", url: "/segmentacao", icon: Target },
]

const navOperacao = [
  { title: "Eventos", url: "/eventos", icon: CalendarRange },
  { title: "Logs", url: "/logs", icon: TriangleAlert },
  { title: "Relatórios", url: "/relatorios", icon: BarChart3 },
]

const navSistema = [
  { title: "Instâncias", url: "/instancias", icon: Smartphone },
  { title: "No Code", url: "/nocode", icon: Workflow },
  { title: "Integrações", url: "/integracoes", icon: Plug },
  { title: "Configurações", url: "/configuracoes", icon: Settings },
]

interface AppSidebarProps {
  instanceName?: string
  instanceState?: string
  profileImageUrl?: string | null
  chatAtivo?: boolean
  kanbanAtivo?: boolean
  assistenteAtivo?: boolean
  nocodeAtivo?: boolean
  crmAtivo?: boolean
  appNome?: string
  appLogo?: string | null
  /** URLs das seções que o usuário logado pode acessar (admin recebe todas). */
  urlsPermitidas?: string[]
  /** Usuário logado (nome, login e nível), exibido no rodapé. */
  usuario?: { nome: string; username: string; role: "admin" | "padrao" } | null
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

export function AppSidebar({
  instanceName,
  instanceState,
  profileImageUrl,
  chatAtivo = false,
  kanbanAtivo = false,
  assistenteAtivo = false,
  nocodeAtivo = false,
  crmAtivo = false,
  appNome = "Medical Spin",
  appLogo = null,
  urlsPermitidas = [],
  usuario = null,
}: AppSidebarProps) {
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
  const visivel = (url: string) => urlsPermitidas.includes(url)
  const itensGestao = navPrincipal.filter(
    (item) =>
      visivel(item.url) &&
      (item.url !== "/chat" || chatAtivo) &&
      (item.url !== "/kanban" || kanbanAtivo) &&
      (item.url !== "/assistente" || assistenteAtivo) &&
      (item.url !== "/nocode" || nocodeAtivo),
  )
  // O CRM (departamentos e atendentes) é gerenciado só por administradores, como Usuários.
  const itensGestaoComCrm =
    crmAtivo && usuario?.role === "admin" ? [...itensGestao, { title: "CRM", url: "/crm", icon: Contact }] : itensGestao
  const itensOperacao = navOperacao.filter((item) => visivel(item.url))
  const itensSistema = [
    ...navSistema.filter((item) => visivel(item.url )),
    ...(usuario?.role === "admin" ? [{ title: "Usuários", url: "/usuarios", icon: UserCog }] : []),
  ]

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1.5 group-data-[collapsible=icon]:px-0">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg text-primary-foreground">
            {appLogo ? (
              <img src={appLogo} alt="" className="size-8 rounded-lg object-cover" />
            ) : (
              <img src="/icon-light-32x32.png" alt="" />
            )}
          </div>
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold leading-tight">{appNome}</span>
            <span className="truncate text-xs text-muted-foreground leading-tight">Follow-up WhatsApp v1.9.0</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {itensGestaoComCrm.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>Gestão</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {itensGestaoComCrm.map((item) => (
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
        ) : null}

        {itensOperacao.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>Acompanhamento</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {itensOperacao.map((item) => (
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
        ) : null}

        {itensSistema.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>Sistema</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {itensSistema.map((item) => (
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
        ) : null}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {usuario ? (
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                isActive={isActive("/conta")}
                title="Minha conta"
                render={
                  <Link href="/conta">
                    <Avatar className="size-8 rounded-lg">
                      <AvatarFallback className="rounded-lg text-xs">
                        {usuario.nome
                          .split(/\s+/)
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((parte) => parte[0]?.toUpperCase() ?? "")
                          .join("") || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col text-left leading-tight">
                      <span className="truncate text-sm font-medium">{usuario.nome}</span>
                      <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        {usuario.role === "admin" ? <ShieldCheck className="size-3" /> : null}
                        {usuario.role === "admin" ? "Administrador" : "Usuário"}
                      </span>
                    </div>
                  </Link>
                }
              />
            </SidebarMenuItem>
          ) : null}
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
