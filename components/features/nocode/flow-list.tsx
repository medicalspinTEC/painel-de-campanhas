"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { GitBranch, Plus, Sparkles, Trash2, Workflow } from "lucide-react"
import { toast } from "sonner"

import { createFlowAction, deleteFlowAction, toggleFlowAction } from "@/app/actions/nocode"
import { LinkButton } from "@/components/shared/link-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { formatRelative } from "@/lib/format"
import type { FlowRow } from "@/services/nocode"

export function FlowList({ fluxos }: { fluxos: FlowRow[] | null }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [novoAberto, setNovoAberto] = useState(false)
  const [nome, setNome] = useState("")
  const [modelo, setModelo] = useState<"resposta" | "vazio">("resposta")
  const [excluir, setExcluir] = useState<FlowRow | null>(null)

  if (fluxos === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Não foi possível carregar os fluxos</CardTitle>
          <CardDescription>
            Aplique a migration mais recente do banco (<code>20261003100000_nocode_plugin</code>) e recarregue a página.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  function abrirNovo(modeloInicial: "resposta" | "vazio") {
    setModelo(modeloInicial)
    setNome(modeloInicial === "resposta" ? "Fluxo de resposta" : "")
    setNovoAberto(true)
  }

  function criar() {
    startTransition(async () => {
      const resultado = await createFlowAction({ nome, modelo })
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }
      setNovoAberto(false)
      router.push(`/nocode/${resultado.id}`)
    })
  }

  function alternar(fluxo: FlowRow, ativo: boolean) {
    startTransition(async () => {
      const resultado = await toggleFlowAction(fluxo.id, ativo)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }
      toast.success(resultado.message)
      router.refresh()
    })
  }

  function confirmarExclusao() {
    if (!excluir) return
    const alvo = excluir
    startTransition(async () => {
      const resultado = await deleteFlowAction(alvo.id)
      if (!resultado.ok) {
        toast.error(resultado.message)
        return
      }
      setExcluir(null)
      toast.success(resultado.message)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => abrirNovo("vazio")}>
          <Plus className="size-4" />
          Novo fluxo
        </Button>
        <Button variant="outline" onClick={() => abrirNovo("resposta")}>
          <Sparkles className="size-4" />
          Modelo: fluxo de resposta
        </Button>
      </div>

      {fluxos.length === 0 ? (
        <Card>
          <CardHeader>
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Workflow className="size-5" />
            </div>
            <CardTitle className="text-base">Nenhum fluxo ainda</CardTitle>
            <CardDescription>
              Comece pelo modelo “fluxo de resposta”: ele recebe a mensagem do WhatsApp, acha o lead pelo telefone e
              registra a resposta quando o lead estiver em uma campanha.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => abrirNovo("resposta")}>
              <Sparkles className="size-4" />
              Criar fluxo de resposta
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {fluxos.map((fluxo) => (
            <Card key={fluxo.id} className="transition-colors hover:bg-muted/30">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/nocode/${fluxo.id}`} className="min-w-0 flex-1 focus-visible:outline-none">
                    <CardTitle className="truncate text-base hover:underline">{fluxo.nome}</CardTitle>
                    <CardDescription className="mt-1 flex items-center gap-2">
                      <GitBranch className="size-3.5" />
                      {fluxo.nodes.length} bloco{fluxo.nodes.length === 1 ? "" : "s"}
                      <span aria-hidden>·</span>
                      <span suppressHydrationWarning>editado {formatRelative(fluxo.atualizadoEm)}</span>
                    </CardDescription>
                  </Link>
                  <Switch
                    checked={fluxo.ativo}
                    onCheckedChange={(valor) => alternar(fluxo, valor)}
                    disabled={pending}
                    aria-label={fluxo.ativo ? "Desativar fluxo" : "Ativar fluxo"}
                  />
                </div>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-2">
                <Badge variant={fluxo.ativo ? "default" : "secondary"}>{fluxo.ativo ? "Ativo" : "Desativado"}</Badge>
                <div className="flex items-center gap-1">
                  <LinkButton variant="outline" size="sm" href={`/nocode/${fluxo.id}`}>
                    Abrir editor
                  </LinkButton>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Excluir ${fluxo.nome}`}
                    title="Excluir"
                    onClick={() => setExcluir(fluxo)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{modelo === "resposta" ? "Novo fluxo de resposta" : "Novo fluxo"}</DialogTitle>
            <DialogDescription>
              {modelo === "resposta"
                ? "Já vem montado: Webhook → telefone → busca o lead → registra a resposta."
                : "Começa em branco; adicione os blocos no editor."}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            placeholder="Nome do fluxo"
            maxLength={80}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter" && nome.trim() && !pending) criar()
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNovoAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={criar} disabled={pending || !nome.trim()}>
              Criar e abrir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={excluir !== null} onOpenChange={(aberto) => !aberto && setExcluir(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir fluxo?</DialogTitle>
            <DialogDescription>
              “{excluir?.nome}” e o histórico de execuções serão apagados. Se a Evolution ainda enviar eventos para ele,
              eles deixarão de ser tratados.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setExcluir(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmarExclusao} disabled={pending}>
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
