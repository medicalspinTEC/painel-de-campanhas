"use client"

import { useState, useTransition } from "react"
import { Crown, Pencil, Plus, ShieldCheck, Trash2, UserCog } from "lucide-react"
import { toast } from "sonner"

import { deleteUserAction } from "@/app/actions/users"
import { UsuarioFormDialog, type AtorUsuario } from "@/components/features/usuarios/usuario-form-dialog"
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
import { PODERES, podeGerenciarNivel, SECOES, temPoder } from "@/lib/permissoes"
import type { Usuario } from "@/services/users"

function rotuloSecoes(chaves: readonly string[]) {
  return chaves.map((key) => SECOES.find((s) => s.key === key)?.label ?? key).join(", ")
}

function rotuloPoderes(chaves: readonly string[]) {
  return chaves.map((key) => PODERES.find((p) => p.key === key)?.label ?? key).join(", ")
}

export function UsuariosManager({ usuarios, ator }: { usuarios: Usuario[]; ator: AtorUsuario }) {
  const [dialogAberto, setDialogAberto] = useState(false)
  const [emEdicao, setEmEdicao] = useState<Usuario | null>(null)
  const [excluindo, setExcluindo] = useState<Usuario | null>(null)
  const [pending, startTransition] = useTransition()

  const ehRoot = ator.role === "root"
  const podeCriar = temPoder(ator, "usuarios_criar")

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
          {podeCriar ? (
            <Button onClick={abrirNovo} className="shrink-0">
              <Plus className="size-4" />
              Novo usuário
            </Button>
          ) : null}
        </CardHeader>

        <CardContent>
          {usuarios.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UserCog className="size-5" aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>Nenhum usuário</EmptyTitle>
                <EmptyDescription>
                  {podeCriar ? "Crie o primeiro usuário para dar acesso ao painel." : "Ainda não há usuários para gerenciar."}
                </EmptyDescription>
              </EmptyHeader>
              {podeCriar ? (
                <EmptyContent>
                  <Button onClick={abrirNovo}>
                    <Plus className="size-4" />
                    Novo usuário
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {usuarios.map((usuario) => {
                const ehVoce = usuario.id === ator.id
                // Root edita a si mesmo (nome/login/senha) e a todos; admin só os usuários padrão.
                const hierarquiaOk = ehVoce ? ehRoot : podeGerenciarNivel(ator, usuario.role)
                const podeEditar = hierarquiaOk && (ehRoot || temPoder(ator, "usuarios_editar") || temPoder(ator, "usuarios_secoes"))
                const podeExcluir = !ehVoce && podeGerenciarNivel(ator, usuario.role) && temPoder(ator, "usuarios_excluir")
                return (
                  <li key={usuario.id} className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{usuario.nome}</span>
                        {ehVoce ? <Badge variant="outline">Você</Badge> : null}
                        {usuario.role === "root" ? (
                          <Badge className="gap-1">
                            <Crown className="size-3" />
                            Root
                          </Badge>
                        ) : usuario.role === "admin" ? (
                          <Badge className="gap-1" variant="secondary">
                            <ShieldCheck className="size-3" />
                            Administrador
                          </Badge>
                        ) : (
                          <Badge variant="outline">Usuário padrão</Badge>
                        )}
                        {!usuario.ativo ? <Badge variant="outline">Inativo</Badge> : null}
                      </div>
                      <span className="text-sm text-muted-foreground">{usuario.username}</span>
                      <span className="text-xs text-muted-foreground">
                        {usuario.role === "root"
                          ? "Acesso total e controle sobre todos os níveis."
                          : usuario.secoes.length === 0
                            ? "Nenhuma seção liberada."
                            : `Acessa: ${rotuloSecoes(usuario.secoes)}.`}
                      </span>
                      {usuario.role === "admin" ? (
                        <span className="text-xs text-muted-foreground">
                          {usuario.poderes.length === 0
                            ? "Não controla nada além do que acessa."
                            : `Pode controlar: ${rotuloPoderes(usuario.poderes)}.`}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {podeEditar ? (
                        <Button variant="outline" size="sm" onClick={() => abrirEdicao(usuario)}>
                          <Pencil className="size-3.5" />
                          Editar
                        </Button>
                      ) : null}
                      {podeExcluir || ehVoce ? (
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
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <UsuarioFormDialog open={dialogAberto} onOpenChange={setDialogAberto} usuario={emEdicao} ator={ator} />

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
