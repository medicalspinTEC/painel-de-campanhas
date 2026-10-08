"use client"

import { useState, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { ChevronRight, ClipboardList, Columns3, Contact, MessageCircle, Puzzle, Sparkles, Workflow } from "lucide-react"
import { toast } from "sonner"

import {
  setAgentesIaPluginAtivoAction,
  setAssistentePluginAtivoAction,
  setChatPluginAtivoAction,
  setCrmPluginAtivoAction,
  setKanbanPluginAtivoAction,
  setNocodePluginAtivoAction,
} from "@/app/actions/settings"
import { LinkButton } from "@/components/shared/link-button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"

type PluginId = "chat" | "kanban" | "assistente" | "nocode" | "crm" | "agentesIa"

function PluginCard({
  titulo,
  ativo,
  icon: Icon,
  onClick,
}: {
  titulo: string
  ativo: boolean
  icon: typeof Puzzle
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className="flex min-h-20 w-full max-w-sm items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 text-left text-card-foreground ring-1 ring-foreground/10 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm font-medium">{titulo}</span>
          <Badge variant={ativo ? "default" : "secondary"} className="w-fit">
            {ativo ? "Ativo" : "Desativado"}
          </Badge>
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

type PluginDetails = {
  id: PluginId
  titulo: string
  descricao: string
  ativo: boolean
  onChange: (ativo: boolean) => void
  icon: typeof Puzzle
  href: string
  acaoLabel: string
  acaoIcon: ReactNode
}

export function PluginsManager({
  chatAtivoInicial,
  kanbanAtivoInicial,
  assistenteAtivoInicial,
  nocodeAtivoInicial,
  crmAtivoInicial,
  agentesIaAtivoInicial,
}: {
  chatAtivoInicial: boolean
  kanbanAtivoInicial: boolean
  assistenteAtivoInicial: boolean
  nocodeAtivoInicial: boolean
  crmAtivoInicial: boolean
  agentesIaAtivoInicial: boolean
}) {
  const router = useRouter()
  const [chatAtivo, setChatAtivo] = useState(chatAtivoInicial)
  const [kanbanAtivo, setKanbanAtivo] = useState(kanbanAtivoInicial)
  const [assistenteAtivo, setAssistenteAtivo] = useState(assistenteAtivoInicial)
  const [nocodeAtivo, setNocodeAtivo] = useState(nocodeAtivoInicial)
  const [crmAtivo, setCrmAtivo] = useState(crmAtivoInicial)
  const [agentesIaAtivo, setAgentesIaAtivo] = useState(agentesIaAtivoInicial)
  const [pending, startTransition] = useTransition()
  const [pluginSelecionado, setPluginSelecionado] = useState<PluginId | null>(null)

  function alterarChat(ativo: boolean) {
    startTransition(async () => {
      const resultado = await setChatPluginAtivoAction(ativo)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }

      setChatAtivo(ativo)
      toast.success(resultado.message)
      router.refresh()
    })
  }

  function alterarKanban(ativo: boolean) {
    startTransition(async () => {
      const resultado = await setKanbanPluginAtivoAction(ativo)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }

      setKanbanAtivo(ativo)
      toast.success(resultado.message)
      router.refresh()
    })
  }

  function alterarAssistente(ativo: boolean) {
    startTransition(async () => {
      const resultado = await setAssistentePluginAtivoAction(ativo)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }

      setAssistenteAtivo(ativo)
      toast.success(resultado.message)
      router.refresh()
    })
  }

  function alterarNocode(ativo: boolean) {
    startTransition(async () => {
      const resultado = await setNocodePluginAtivoAction(ativo)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }

      setNocodeAtivo(ativo)
      toast.success(resultado.message)
      router.refresh()
    })
  }

  function alterarCrm(ativo: boolean) {
    startTransition(async () => {
      const resultado = await setCrmPluginAtivoAction(ativo)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }

      setCrmAtivo(ativo)
      toast.success(resultado.message)
      router.refresh()
    })
  }

  function alterarAgentesIa(ativo: boolean) {
    startTransition(async () => {
      const resultado = await setAgentesIaPluginAtivoAction(ativo)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }

      setAgentesIaAtivo(ativo)
      toast.success(resultado.message)
      router.refresh()
    })
  }

  const detalhes: PluginDetails | null =
    pluginSelecionado === "chat"
      ? {
          id: "chat",
          titulo: "Chat",
          descricao: "Caixa de entrada para consultar conversas e responder aos leads cadastrados.",
          ativo: chatAtivo,
          onChange: alterarChat,
          icon: MessageCircle,
          href: "/chat",
          acaoLabel: "Abrir Chat",
          acaoIcon: <MessageCircle className="size-4" />,
        }
      : pluginSelecionado === "kanban"
        ? {
            id: "kanban",
            titulo: "Kanban",
            descricao: "Quadro que organiza os leads em colunas por status. Arraste o cartão para mudar o status.",
            ativo: kanbanAtivo,
            onChange: alterarKanban,
            icon: Columns3,
            href: "/kanban",
            acaoLabel: "Abrir Kanban",
            acaoIcon: <Columns3 className="size-4" />,
          }
        : pluginSelecionado === "assistente"
          ? {
              id: "assistente",
              titulo: "Assistente",
              descricao:
                "Agente determinístico do app, sem IA. No momento, consulta leads cuja última mensagem enviada há mais de 24 horas ainda não teve resposta.",
              ativo: assistenteAtivo,
              onChange: alterarAssistente,
              icon: ClipboardList,
              href: "/assistente",
              acaoLabel: "Abrir Assistente",
              acaoIcon: <ClipboardList className="size-4" />,
            }
        : pluginSelecionado === "nocode"
          ? {
              id: "nocode",
              titulo: "No Code",
              descricao:
                "Editor visual de fluxos de automação do próprio app, sem serviços externos. Receba os eventos da Evolution API e trate as respostas dos leads direto aqui.",
              ativo: nocodeAtivo,
              onChange: alterarNocode,
              icon: Workflow,
              href: "/nocode",
              acaoLabel: "Abrir No Code",
              acaoIcon: <Workflow className="size-4" />,
            }
        : pluginSelecionado === "crm"
          ? {
              id: "crm",
              titulo: "CRM",
              descricao:
                "Departamentos e atendentes (usuários admin ou comuns). Com o plugin Chat ativo, o chat ganha a transferência de conversas por departamento e atendente.",
              ativo: crmAtivo,
              onChange: alterarCrm,
              icon: Contact,
              href: "/crm",
              acaoLabel: "Abrir CRM",
              acaoIcon: <Contact className="size-4" />,
            }
          : pluginSelecionado === "agentesIa"
            ? {
                id: "agentesIa",
                titulo: "Agentes de IA",
                descricao:
                  "Agentes de atendimento com IA (Claude, Groq ou outra API compatível, via chave de API) que respondem as mensagens dos leads. Podem ser vinculados a um departamento ou ser o agente de entrada na aba CRM (exige o plugin CRM ativo). Por enquanto só respondem mensagens, sem executar comandos.",
                ativo: agentesIaAtivo,
                onChange: alterarAgentesIa,
                icon: Sparkles,
                href: "/agentes-ia",
                acaoLabel: "Abrir Agentes de IA",
                acaoIcon: <Sparkles className="size-4" />,
              }
            : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">Plugins disponíveis</h2>
        <p className="text-sm text-muted-foreground">Ative os recursos opcionais que devem aparecer no painel.</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <PluginCard
          titulo="Chat"
          ativo={chatAtivo}
          icon={MessageCircle}
          onClick={() => setPluginSelecionado("chat")}
        />
        <PluginCard
          titulo="Kanban"
          ativo={kanbanAtivo}
          icon={Columns3}
          onClick={() => setPluginSelecionado("kanban")}
        />
        <PluginCard
          titulo="Assistente"
          ativo={assistenteAtivo}
          icon={ClipboardList}
          onClick={() => setPluginSelecionado("assistente")}
        />
        <PluginCard
          titulo="No Code"
          ativo={nocodeAtivo}
          icon={Workflow}
          onClick={() => setPluginSelecionado("nocode")}
        />
        <PluginCard
          titulo="CRM"
          ativo={crmAtivo}
          icon={Contact}
          onClick={() => setPluginSelecionado("crm")}
        />
        <PluginCard
          titulo="Agentes de IA"
          ativo={agentesIaAtivo}
          icon={Sparkles}
          onClick={() => setPluginSelecionado("agentesIa")}
        />
      </div>

      <Dialog open={pluginSelecionado !== null} onOpenChange={(open) => !open && setPluginSelecionado(null)}>
        <DialogContent className="sm:max-w-md">
          {detalhes ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <detalhes.icon className="size-4 text-primary" />
                  {detalhes.titulo}
                </DialogTitle>
                <DialogDescription>{detalhes.descricao}</DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Ativar plugin</span>
                  <span className="text-xs text-muted-foreground">
                    {detalhes.ativo ? "Disponível no painel." : "Oculto no painel enquanto estiver desativado."}
                  </span>
                </div>
                <Switch
                  id={`plugin-${detalhes.id}`}
                  aria-label={`Ativar plugin ${detalhes.titulo}`}
                  checked={detalhes.ativo}
                  onCheckedChange={detalhes.onChange}
                  disabled={pending}
                />
              </div>
              {detalhes.ativo ? (
                <LinkButton href={detalhes.href} size="sm" className="w-fit">
                  {detalhes.acaoIcon}
                  {detalhes.acaoLabel}
                </LinkButton>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
