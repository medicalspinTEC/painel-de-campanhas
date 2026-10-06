"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Bot, ExternalLink, Plus, Power, PowerOff, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { createBotAction, deleteBotAction, setBotAtivoAction } from "@/app/actions/crm"
import { LinkButton } from "@/components/shared/link-button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import type { BotItem } from "@/services/crm"

/**
 * Bots (fluxos No Code do tipo "bot") de um escopo: o bot de entrada (`departamentoId` nulo) ou
 * os de um departamento. Só um bot fica ativo por escopo; o fluxo em si é montado no No Code.
 */
export function BotsLista({
  bots,
  departamentoId,
  rotuloEscopo,
  podeEditarNoCode,
}: {
  bots: BotItem[]
  departamentoId: string | null
  /** Ex.: "do departamento Comercial" ou "de entrada". Só para os textos. */
  rotuloEscopo: string
  /** Tem acesso ao No Code (seção liberada e plugin ativo): sem isso o link do editor não aparece. */
  podeEditarNoCode: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [novoAberto, setNovoAberto] = useState(false)
  const [nome, setNome] = useState("")
  const [excluindo, setExcluindo] = useState<BotItem | null>(null)

  function abrirNovo() {
    setNome("")
    setNovoAberto(true)
  }

  function criar() {
    startTransition(async () => {
      const resultado = await createBotAction({ nome, departamentoId })
      if (!resultado.ok || !resultado.id) {
        toast.error(resultado.message)
        return
      }
      toast.success(resultado.message)
      setNovoAberto(false)
      if (podeEditarNoCode) router.push(`/nocode/${resultado.id}`)
      else router.refresh()
    })
  }

  function alternar(bot: BotItem) {
    startTransition(async () => {
      const resultado = await setBotAtivoAction(bot.id, !bot.ativo)
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
    })
  }

  function confirmarExclusao() {
    if (!excluindo) return
    const id = excluindo.id
    startTransition(async () => {
      const resultado = await deleteBotAction(id)
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
      setExcluindo(null)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {bots.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum bot {rotuloEscopo}.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {bots.map((bot) => (
            <li key={bot.id} className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Bot className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate text-sm font-medium">{bot.nome}</span>
                <Badge variant={bot.ativo ? "default" : "secondary"}>{bot.ativo ? "Ativo" : "Desativado"}</Badge>
                <span className="text-xs text-muted-foreground">
                  {bot.totalBlocos} {bot.totalBlocos === 1 ? "bloco" : "blocos"}
                </span>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {podeEditarNoCode ? (
                  <LinkButton variant="outline" size="sm" href={`/nocode/${bot.id}`}>
                    <ExternalLink className="size-3.5" />
                    Editar fluxo
                  </LinkButton>
                ) : null}
                <Button variant="outline" size="sm" disabled={pending} onClick={() => alternar(bot)}>
                  {bot.ativo ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
                  {bot.ativo ? "Desativar" : "Ativar"}
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Excluir ${bot.nome}`} title="Excluir" onClick={() => setExcluindo(bot)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div>
        <Button variant="outline" size="sm" onClick={abrirNovo}>
          <Plus className="size-3.5" />
          Novo bot
        </Button>
      </div>

      <Dialog open={novoAberto} onOpenChange={setNovoAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo bot {rotuloEscopo}</DialogTitle>
            <DialogDescription>
              O bot é um fluxo do No Code: começa com um modelo pronto, que você edita, e só passa a responder depois de ativado.
              {podeEditarNoCode ? "" : " Você não tem acesso ao No Code; peça a quem tem para montar o fluxo."}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={nome}
            onChange={(event) => setNome(event.target.value)}
            placeholder="Nome do bot"
            maxLength={80}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter" && nome.trim() && !pending) criar()
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNovoAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={criar} disabled={pending || nome.trim().length < 2}>
              {pending ? <Spinner /> : null}
              {podeEditarNoCode ? "Criar e abrir o editor" : "Criar bot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(excluindo)} onOpenChange={(aberto) => !aberto && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir bot?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluindo ? `“${excluindo.nome}” e o histórico das execuções dele serão removidos. Esta ação não pode ser desfeita.` : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmarExclusao} disabled={pending}>
              {pending ? <Spinner /> : null}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
