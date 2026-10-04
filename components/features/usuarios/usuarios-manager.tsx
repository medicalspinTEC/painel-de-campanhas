"use client"

import { useState, useTransition } from "react"
import { Pencil, Plus, ShieldCheck, Trash2, UserCog } from "lucide-react"
import { toast } from "sonner"

import { deleteUserAction } from "@/app/actions/users"
import { UsuarioFormDialog } from "@/components/features/usuarios/usuario-form-dialog"
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
import { SECOES } from "@/lib/permissoes"
import type { Usuario } from "@/services/users"

export function UsuariosManager({ usuarios, usuarioAtualId }: { usuarios: Usuario[]; usuarioAtualId: string }) {
  const [dialogAberto, setDialogAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<Usuario | null>(null)
  const [excluindo, setExcluindo] = useState<Usuario | null>(null)
  const [pending, startTransition] = useTransition()

  function abrirNovo() {
    setEmEdicao(null)
    setDialogAberto(true)
  }

  function abrirEdicao(usuario: Usuario) {
    setEmEdicao(usuario)
    setDialogAberto(true)
  }

  function confirmarExclusao() {
    if (!excluindo) return
    const id = excluindo.id
    startTransition(async () => {
      const resultado = await deleteUserAction(id)
      if (resultado.ok) toast.success(resultado.message)
      else toast.error(resultado.message)
      setExcluindo(null)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="flex items-center gap-2">
              <UserCog className="size-4 text-muted-foreground" aria-hidden="true" />
              Usuários
            </CardTitle>
            <CardDescription>
              {usuarios.length} {usuarios.length === 1 ? "usuário cadastrado" : "usuários cadastrados"}. Alterações de
              acesso valem imediatamente.
            </CardDescription>
          </div>
          <Button onClick={abrirNovo} className="shrink-0">
            <Plus className="size-4" />
            Novo usuário
          </Button>
        </CardHeader>

        <CardContent>
          {usuarios.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UserCog className="size-5" aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>Nenhum usuário</EmptyTitle>
                <EmptyDescription>Crie o primeiro usuário para dar acesso ao painel.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={abrirNovo}>
                  <Plus className="size-4" />
                  Novo usuário
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {usuarios.map((usuario) => {
                const ehVoce = usuario.id === usuarioAtualId
                return (
                  <li key={usuario.id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{usuario.nome}</span>
                        {ehVoce ? <Badge variant="outline">Você</Badge> : null}
                        {usuario.role === "admin" ? (
                          <Badge className="gap-1">
                            <ShieldCheck className="size-3" />
                            Administrador
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Usuário padrão</Badge>
                        )}
                        {!usuario.ativo ? <Badge variant="outline">Inativo</Badge> : null}
                      </div>
                      <span className="text-sm text-muted-foreground">{usuario.username}</span>
                      <span className="text-xs text-muted-foreground">
                        {usuario.role === "admin"
                          ? "Acesso total ao painel."
                          : usuario.secoes.length === 0
                            ? "Nenhuma seção liberada."
                            : `Acessa: ${usuario.secoes
                                .map((key) => SECOES.find((s) => s.key === key)?.label ?? key)
                                .join(", ")}.`}
                      </span>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="outline" size="sm" onClick={() => abrirEdicao(usuario)}>
                        <Pencil className="size-3.5" />
                        Editar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={ehVoce}
                        title={ehVoce ? "Você não pode excluir o próprio usuário" : undefined}
                        onClick={() => setExcluindo(usuario)}
                      >
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

      <UsuarioFormDialog
        open={dialogAberto}
        onOpenChange={setDialogAberto}
        usuario={emEdicao}
        usuarioAtualId={usuarioAtualId}
      />

      <AlertDialog open={Boolean(excluindo)} onOpenChange={(aberto) => !aberto && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluindo
                ? `"${excluindo.nome}" perderá o acesso ao painel imediatamente. Esta ação não pode ser desfeita.`
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
