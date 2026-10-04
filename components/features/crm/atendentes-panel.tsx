"use client"

import { useState, useTransition } from "react"
import { Headset, Pencil, Plus, Power, PowerOff, ShieldCheck, Trash2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { deleteAtendenteAction, setAtendenteAtivoAction } from "@/app/actions/crm"
import { AtendenteFormDialog } from "@/components/features/crm/atendente-form-dialog"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import type { AtendenteItem, DepartamentoItem, UsuarioDisponivel } from "@/services/crm"

export function AtendentesPanel({
  atendentes,
  departamentos,
  usuariosDisponiveis,
  chatAtivo,
  usuarioAtualId,
}: {
  atendentes: AtendenteItem[]
  departamentos: DepartamentoItem[]
  usuariosDisponiveis: UsuarioDisponivel[]
  chatAtivo: boolean
  usuarioAtualId: string
}) {
  const [dialogAberto, setDialogAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<AtendenteItem | null>(null)
  const [excluindo, setExcluindo] = useState<AtendenteItem | null>(null)
  const [excluirUsuario, setExcluirUsuario] = useState(false)
  const [pending, startTransition] = useTransition()

  const nomeDoDepartamento = new Map(departamentos.map((departamento) => [departamento.id, departamento.nome]))

  function abrirNovo() {
    setEmEdicao(null)
    setDialogAberto(true)
  }

  function abrirEdicao(atendente: AtendenteItem) {
    setEmEdicao(atendente)
    setDialogAberto(true)
  }

  function alternarAtivo(atendente: AtendenteItem) {
    startTransition(async () => {
      const resultado = await setAtendenteAtivoAction(atendente.id, !atendente.ativo)
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
    })
  }

  function pedirExclusao(atendente: AtendenteItem) {
    setExcluirUsuario(false)
    setExcluindo(atendente)
  }

  function confirmarExclusao() {
    if (!excluindo) return
    const { id } = excluindo
    startTransition(async () => {
      const resultado = await deleteAtendenteAction(id, excluirUsuario)
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
      setExcluindo(null)
    })
  }

  const excluindoASiMesmo = excluindo?.userId === usuarioAtualId

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2">
              <Headset className="size-4 text-muted-foreground" aria-hidden="true" />
              Atendentes
            </CardTitle>
            <CardDescription>
              {atendentes.length} {atendentes.length === 1 ? "atendente cadastrado" : "atendentes cadastrados"}. Cada um é
              um usuário do painel, administrador ou comum.
            </CardDescription>
          </div>
          <Button onClick={abrirNovo} className="shrink-0">
            <Plus className="size-4" />
            Novo atendente
          </Button>
        </CardHeader>

        <CardContent>
          {atendentes.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Headset className="size-5" aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>Nenhum atendente</EmptyTitle>
                <EmptyDescription>Crie um atendente novo ou transforme um usuário existente em atendente.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={abrirNovo}>
                  <Plus className="size-4" />
                  Novo atendente
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {atendentes.map((atendente) => {
                const ehVoce = atendente.userId === usuarioAtualId
                const nomesDepartamentos = atendente.departamentoIds
                  .map((id) => nomeDoDepartamento.get(id))
                  .filter((nome): nome is string => Boolean(nome))
                return (
                  <li
                    key={atendente.id}
                    className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{atendente.nome}</span>
                        {ehVoce ? <Badge variant="outline">Você</Badge> : null}
                        {atendente.role === "admin" ? (
                          <Badge className="gap-1">
                            <ShieldCheck className="size-3" />
                            Administrador
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Usuário padrão</Badge>
                        )}
                        {!atendente.ativo ? <Badge variant="outline">Inativo</Badge> : null}
                        {!atendente.usuarioAtivo ? <Badge variant="outline">Login inativo</Badge> : null}
                        {chatAtivo && !atendente.acessaChat ? (
                          <Badge
                            variant="destructive"
                            className="gap-1"
                            title="Libere a seção Chat em Usuários para que ele consiga atender."
                          >
                            <TriangleAlert className="size-3" />
                            Sem acesso ao Chat
                          </Badge>
                        ) : null}
                      </div>
                      <span className="text-sm text-muted-foreground">{atendente.username}</span>
                      <span className="text-xs text-muted-foreground">
                        {nomesDepartamentos.length > 0
                          ? `Departamentos: ${nomesDepartamentos.join(", ")}.`
                          : "Sem departamento."}{" "}
                        {atendente.totalConversas} {atendente.totalConversas === 1 ? "conversa" : "conversas"}.
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => abrirEdicao(atendente)}>
                        <Pencil className="size-3.5" />
                        Editar
                      </Button>
                      <Button variant="outline" size="sm" disabled={pending} onClick={() => alternarAtivo(atendente)}>
                        {atendente.ativo ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
                        {atendente.ativo ? "Inativar" : "Ativar"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => pedirExclusao(atendente)}>
                        <Trash2 className="size-3.5" />
                        Excluir
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <AtendenteFormDialog
        open={dialogAberto}
        onOpenChange={setDialogAberto}
        atendente={emEdicao}
        departamentos={departamentos}
        usuariosDisponiveis={usuariosDisponiveis}
        usuarioAtualId={usuarioAtualId}
      />

      <AlertDialog open={Boolean(excluindo)} onOpenChange={(aberto) => !aberto && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir atendente?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluindo
                ? `"${excluindo.nome}" deixa de ser atendente.${
                    excluindo.totalConversas > 0
                      ? ` ${excluindo.totalConversas} ${excluindo.totalConversas === 1 ? "conversa ficará" : "conversas ficarão"} sem atendente (o departamento é mantido).`
                      : ""
                  } O usuário continua com acesso ao painel, a menos que você marque a opção abaixo.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label
            htmlFor="excluir-usuario"
            className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${excluindoASiMesmo ? "opacity-60" : "cursor-pointer"}`}
          >
            <Checkbox
              id="excluir-usuario"
              checked={excluirUsuario}
              disabled={excluindoASiMesmo}
              onCheckedChange={(marcado) => setExcluirUsuario(Boolean(marcado))}
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">Excluir também o usuário de login</span>
              <span className="text-xs text-muted-foreground">
                {excluindoASiMesmo
                  ? "Você não pode excluir o próprio usuário."
                  : "A pessoa perde o acesso ao painel imediatamente. Não pode ser desfeito."}
              </span>
            </span>
          </label>
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
