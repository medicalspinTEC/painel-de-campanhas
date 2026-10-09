"use client"

import { useState, useTransition } from "react"
import { Bot, Pencil, Plus, Power, PowerOff, Sparkles, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { deleteAgenteIaAction, setAgenteIaAtivoAction } from "@/app/actions/agentes-ia"
import { AgenteFormDialog } from "@/components/features/agentes-ia/agente-form-dialog"
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { descreverTempo, infoDoProvedor } from "@/lib/agentes-ia"
import type { AgenteIaItem } from "@/services/agentes-ia"

export function AgentesManager({
  agentes,
  crmAtivo,
  podeAbrirCrm,
}: {
  agentes: AgenteIaItem[]
  crmAtivo: boolean
  podeAbrirCrm: boolean
}) {
  const [dialogAberto, setDialogAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<AgenteIaItem | null>(null)
  const [excluindo, setExcluindo] = useState<AgenteIaItem | null>(null)
  const [pending, startTransition] = useTransition()

  function abrirNovo() {
    setEmEdicao(null)
    setDialogAberto(true)
  }

  function abrirEdicao(agente: AgenteIaItem) {
    setEmEdicao(agente)
    setDialogAberto(true)
  }

  function alternar(agente: AgenteIaItem) {
    startTransition(async () => {
      const resultado = await setAgenteIaAtivoAction(agente.id, !agente.ativo)
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
    })
  }

  function confirmarExclusao() {
    if (!excluindo) return
    const id = excluindo.id
    startTransition(async () => {
      const resultado = await deleteAgenteIaAction(id)
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
      setExcluindo(null)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {!crmAtivo ? (
        <Alert>
          <Sparkles className="size-4" aria-hidden="true" />
          <AlertTitle>Ative o plugin CRM para os agentes responderem</AlertTitle>
          <AlertDescription>
            Os agentes atendem as conversas por departamento ou pela entrada, que ficam no plugin CRM. Sem o CRM ativo, os agentes não respondem.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2">
              <Bot className="size-4 text-muted-foreground" aria-hidden="true" />
              Agentes
            </CardTitle>
            <CardDescription>
              {agentes.length} {agentes.length === 1 ? "agente cadastrado" : "agentes cadastrados"}. O agente responde mensagens e para
              quando um humano assume a conversa (só vale para conversas sem campanha). Mesmo com um atendente na conversa, ele pode sugerir respostas no chat.
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {podeAbrirCrm ? (
              <LinkButton variant="outline" href="/crm">
                Vincular no CRM
              </LinkButton>
            ) : null}
            <Button onClick={abrirNovo}>
              <Plus className="size-4" />
              Novo agente
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {agentes.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Sparkles className="size-5" aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>Nenhum agente</EmptyTitle>
                <EmptyDescription>Crie o primeiro agente de atendimento com a chave de API do provedor (Claude, Groq ou outro compatível).</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={abrirNovo}>
                  <Plus className="size-4" />
                  Novo agente
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {agentes.map((agente) => {
                const vinculado = agente.entrada || agente.departamentos.length > 0
                return (
                  <li key={agente.id} className="flex flex-col gap-3 rounded-xl border p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{agente.nome}</span>
                          <Badge variant={agente.ativo ? "default" : "secondary"}>{agente.ativo ? "Ativo" : "Desativado"}</Badge>
                          {!agente.temChave ? <Badge variant="destructive">Sem chave de API</Badge> : null}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {infoDoProvedor(agente.provedor).label} · {agente.modelo}
                          {agente.chaveFinal ? ` · chave ${agente.chaveFinal}` : ""}
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {agente.entrada ? <Badge variant="outline">Agente de entrada</Badge> : null}
                          {agente.reativarAposMinutos ? (
                            <Badge variant="secondary">Reativa após {descreverTempo(agente.reativarAposMinutos)}</Badge>
                          ) : null}
                          {agente.departamentos.map((d) => (
                            <Badge key={d.id} variant="outline">
                              {d.nome}
                            </Badge>
                          ))}
                          {!vinculado ? (
                            <span className="text-xs text-muted-foreground">Não vinculado: vincule a um departamento ou à entrada na aba CRM.</span>
                          ) : null}
                        </div>
                        <p className="line-clamp-2 whitespace-pre-line text-sm text-muted-foreground">{agente.prompt}</p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => abrirEdicao(agente)}>
                          <Pencil className="size-3.5" />
                          Editar
                        </Button>
                        <Button variant="outline" size="sm" disabled={pending} onClick={() => alternar(agente)}>
                          {agente.ativo ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
                          {agente.ativo ? "Desativar" : "Ativar"}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setExcluindo(agente)}>
                          <Trash2 className="size-3.5" />
                          Excluir
                        </Button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <AgenteFormDialog open={dialogAberto} onOpenChange={setDialogAberto} agente={emEdicao} />

      <AlertDialog open={Boolean(excluindo)} onOpenChange={(aberto) => !aberto && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir agente?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluindo
                ? `“${excluindo.nome}” será removido${
                    excluindo.entrada || excluindo.departamentos.length > 0
                      ? " e deixará de atender a entrada e os departamentos vinculados"
                      : ""
                  }. Esta ação não pode ser desfeita. Para só parar de responder, use Desativar.`
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
