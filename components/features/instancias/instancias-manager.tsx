"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Ellipsis,
  MessageSquare,
  Plus,
  Power,
  QrCode,
  RefreshCw,
  Signal,
  Smartphone,
  Trash2,
} from "lucide-react"

import { criarInstanciaAction } from "@/app/actions/instancias"
import { ConnectInstanceDialog } from "@/components/features/instancias/connect-instance-dialog"
import { InstanceFormDialog } from "@/components/features/instancias/instance-form-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"

export type InstanceState = "conectado" | "conectando" | "desconectado"

export type Instance = {
  id: string
  nome: string
  numero?: string
  descricao?: string
  estado: InstanceState
  mensagensHoje: number
}

const estadoMeta: Record<InstanceState, { label: string; dot: string; badge: string }> = {
  conectado: {
    label: "Conectado",
    dot: "bg-emerald-500",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  conectando: {
    label: "Conectando",
    dot: "bg-amber-500 animate-pulse",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  desconectado: {
    label: "Desconectado",
    dot: "bg-muted-foreground/50",
    badge: "border-muted-foreground/30 bg-muted text-muted-foreground",
  },
}

function iniciais(nome: string) {
  return (
    nome
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "W"
  )
}

export function InstanciasManager({ instanciasIniciais }: { instanciasIniciais: Instance[] }) {
  const router = useRouter()
  const [instancias, setInstancias] = useState<Instance[]>(instanciasIniciais)
  const [formAberto, setFormAberto] = useState(false)
  const [conectando, setConectando] = useState<Instance | null>(null)
  const [criando, iniciarCriacao] = useTransition()
  const [atualizando, iniciarAtualizacao] = useTransition()

  // Quando a página recarrega os dados do servidor (após criar ou "Atualizar"),
  // sincronizamos com a verdade da Evolution API.
  useEffect(() => {
    setInstancias(instanciasIniciais)
  }, [instanciasIniciais])

  const totais = useMemo(() => {
    return {
      total: instancias.length,
      conectadas: instancias.filter((i) => i.estado === "conectado").length,
      mensagens: instancias.reduce((soma, i) => soma + i.mensagensHoje, 0),
    }
  }, [instancias])

  function criarInstancia(dados: { nome: string; numero?: string; descricao?: string }) {
    iniciarCriacao(async () => {
      const resultado = await criarInstanciaAction({ nome: dados.nome, numero: dados.numero })
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }

      toast.success(resultado.message)
      setFormAberto(false)

      if (resultado.instancia) {
        const nova = resultado.instancia
        setInstancias((atuais) =>
          atuais.some((i) => i.id === nova.id) ? atuais : [...atuais, nova],
        )
        // Abre direto o pareamento (visual), como no fluxo real da Evolution.
        setConectando(nova)
      }

      // Puxa a lista atualizada direto da Evolution API.
      router.refresh()
    })
  }

  function atualizarLista() {
    iniciarAtualizacao(() => {
      router.refresh()
    })
  }

  function alternarConexao(instancia: Instance) {
    setInstancias((atuais) =>
      atuais.map((i) =>
        i.id === instancia.id
          ? { ...i, estado: i.estado === "conectado" ? "desconectado" : "conectado" }
          : i,
      ),
    )
  }

  function removerInstancia(id: string) {
    setInstancias((atuais) => atuais.filter((i) => i.id !== id))
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ResumoCard icon={Smartphone} label="Instâncias" valor={totais.total} />
        <ResumoCard icon={Signal} label="Conectadas" valor={totais.conectadas} />
        <ResumoCard icon={MessageSquare} label="Mensagens hoje" valor={totais.mensagens} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold">Suas instâncias</h2>
          <p className="text-xs text-muted-foreground">
            Cada instância é uma conexão de WhatsApp usada para os disparos.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={atualizarLista} disabled={atualizando}>
            <RefreshCw className={cn("size-4", atualizando && "animate-spin")} />
            Atualizar
          </Button>
          <Button onClick={() => setFormAberto(true)}>
            <Plus className="size-4" />
            Nova instância
          </Button>
        </div>
      </div>

      {instancias.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Smartphone className="size-5" aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Nenhuma instância encontrada</EmptyTitle>
            <EmptyDescription>
              Crie uma instância na Evolution API e faça o pareamento pelo QR Code para começar a disparar mensagens.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setFormAberto(true)}>
              <Plus className="size-4" />
              Nova instância
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {instancias.map((instancia) => {
            const meta = estadoMeta[instancia.estado]
            return (
              <Card key={instancia.id} className="overflow-hidden">
                <CardContent className="flex flex-col gap-4 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar size="sm" className="shrink-0">
                        <AvatarFallback className="text-[11px] font-semibold">
                          {iniciais(instancia.nome)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium leading-tight">{instancia.nome}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {instancia.numero ?? "Sem número vinculado"}
                        </p>
                      </div>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon-sm" aria-label={`Ações de ${instancia.nome}`}>
                            <Ellipsis className="size-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setConectando(instancia)}>
                          <QrCode className="size-4" />
                          Conectar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => alternarConexao(instancia)}>
                          <Power className="size-4" />
                          {instancia.estado === "conectado" ? "Desconectar" : "Marcar conectado"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => removerInstancia(instancia.id)}>
                          <Trash2 className="size-4" />
                          Remover
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {instancia.descricao ? (
                    <p className="text-xs text-muted-foreground leading-relaxed">{instancia.descricao}</p>
                  ) : null}

                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className={cn("gap-1.5", meta.badge)}>
                      <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
                      {meta.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {instancia.mensagensHoje} msg hoje
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {instancia.estado === "conectado" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => alternarConexao(instancia)}
                      >
                        <Power className="size-4" />
                        Desconectar
                      </Button>
                    ) : (
                      <Button size="sm" className="flex-1" onClick={() => setConectando(instancia)}>
                        <QrCode className="size-4" />
                        Conectar
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Recarregar ${instancia.nome}`}
                    >
                      <RefreshCw className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <InstanceFormDialog
        open={formAberto}
        onOpenChange={setFormAberto}
        onCriar={criarInstancia}
        pending={criando}
      />

      <ConnectInstanceDialog
        instancia={conectando}
        onOpenChange={(aberto) => !aberto && setConectando(null)}
        onConectar={(id) => {
          setInstancias((atuais) =>
            atuais.map((i) => (i.id === id ? { ...i, estado: "conectado" } : i)),
          )
          setConectando(null)
        }}
      />
    </div>
  )
}

function ResumoCard({
  icon: Icon,
  label,
  valor,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  valor: number
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div className="flex flex-col">
          <span className="text-xl font-semibold leading-none tabular-nums">{valor}</span>
          <span className="mt-1 text-xs text-muted-foreground">{label}</span>
        </div>
      </CardContent>
    </Card>
  )
}
