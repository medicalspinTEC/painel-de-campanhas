"use client"

import { useState, useTransition } from "react"
import { Bot, Building2, Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { deleteDepartamentoAction, setDepartamentoAtivoAction } from "@/app/actions/crm"
import { BotsLista } from "@/components/features/crm/bots-lista"
import { DepartamentoFormDialog } from "@/components/features/crm/departamento-form-dialog"
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import type { BotItem, DepartamentoItem } from "@/services/crm"

export function DepartamentosPanel({
  departamentos,
  botsEntrada,
  chatAtivo,
  podeEditarNoCode,
}: {
  departamentos: DepartamentoItem[]
  botsEntrada: BotItem[]
  chatAtivo: boolean
  podeEditarNoCode: boolean
}) {
  const [dialogAberto, setDialogAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<DepartamentoItem | null>(null)
  const [excluindo, setExcluindo] = useState<DepartamentoItem | null>(null)
  const [pending, startTransition] = useTransition()

  function abrirNovo() {
    setEmEdicao(null)
    setDialogAberto(true)
  }

  function abrirEdicao(departamento: DepartamentoItem) {
    setEmEdicao(departamento)
    setDialogAberto(true)
  }

  function alternarAtivo(departamento: DepartamentoItem) {
    startTransition(async () => {
      const resultado = await setDepartamentoAtivoAction(departamento.id, !departamento.ativo)
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
    })
  }

  function confirmarExclusao() {
    if (!excluindo) return
    const id = excluindo.id
    startTransition(async () => {
      const resultado = await deleteDepartamentoAction(id)
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
      setExcluindo(null)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4 text-muted-foreground" aria-hidden="true" />
            Bot de entrada
          </CardTitle>
          <CardDescription>
            Atende quem ainda não está em nenhum departamento: por exemplo, pergunta com qual departamento o lead quer falar e
            responde conforme a opção escolhida. Quando um humano assume a conversa, o bot para de responder nela até você
            reativá-lo no chat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BotsLista bots={botsEntrada} departamentoId={null} rotuloEscopo="de entrada" podeEditarNoCode={podeEditarNoCode} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
              Departamentos
            </CardTitle>
            <CardDescription>
              {departamentos.length} {departamentos.length === 1 ? "departamento cadastrado" : "departamentos cadastrados"}.
              {chatAtivo ? "" : " Ative o plugin Chat para transferir conversas entre eles."}
            </CardDescription>
          </div>
          <Button onClick={abrirNovo} className="shrink-0">
            <Plus className="size-4" />
            Novo departamento
          </Button>
        </CardHeader>

        <CardContent>
          {departamentos.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Building2 className="size-5" aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>Nenhum departamento</EmptyTitle>
                <EmptyDescription>Crie o primeiro departamento, como Comercial ou Suporte.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={abrirNovo}>
                  <Plus className="size-4" />
                  Novo departamento
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {departamentos.map((departamento) => (
                <li key={departamento.id} className="flex flex-col gap-3 rounded-xl border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{departamento.nome}</span>
                      {!departamento.ativo ? <Badge variant="outline">Inativo</Badge> : null}
                    </div>
                    {departamento.descricao ? (
                      <span className="text-sm text-muted-foreground">{departamento.descricao}</span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {departamento.totalAtendentes} {departamento.totalAtendentes === 1 ? "atendente" : "atendentes"} ·{" "}
                      {departamento.totalConversas} {departamento.totalConversas === 1 ? "conversa" : "conversas"}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => abrirEdicao(departamento)}>
                      <Pencil className="size-3.5" />
                      Editar
                    </Button>
                    <Button variant="outline" size="sm" disabled={pending} onClick={() => alternarAtivo(departamento)}>
                      {departamento.ativo ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
                      {departamento.ativo ? "Inativar" : "Ativar"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setExcluindo(departamento)}>
                      <Trash2 className="size-3.5" />
                      Excluir
                    </Button>
                  </div>
                  </div>
                  <div className="flex flex-col gap-2 border-t pt-3">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Bot className="size-3.5" aria-hidden="true" />
                      Bots e fluxos de resposta
                    </p>
                    <BotsLista
                      bots={departamento.bots}
                      departamentoId={departamento.id}
                      rotuloEscopo={`do departamento ${departamento.nome}`}
                      podeEditarNoCode={podeEditarNoCode}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <DepartamentoFormDialog open={dialogAberto} onOpenChange={setDialogAberto} departamento={emEdicao} />

      <AlertDialog open={Boolean(excluindo)} onOpenChange={(aberto) => !aberto && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir departamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluindo
                ? `"${excluindo.nome}" será removido e os atendentes deixam de pertencer a ele.${
                    excluindo.bots.length > 0
                      ? ` ${excluindo.bots.length === 1 ? "O bot dele será desativado" : "Os bots dele serão desativados"} (continuam no No Code, sem departamento).`
                      : ""
                  }${
                    excluindo.totalConversas > 0
                      ? ` ${excluindo.totalConversas} ${excluindo.totalConversas === 1 ? "conversa ficará" : "conversas ficarão"} sem departamento.`
                      : ""
                  } Esta ação não pode ser desfeita. Se preferir só parar de receber transferências, use Inativar.`
                : null}
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
