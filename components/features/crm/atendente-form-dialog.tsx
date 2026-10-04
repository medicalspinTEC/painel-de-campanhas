"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { createAtendenteAction, updateAtendenteAction } from "@/app/actions/crm"
import { SelectField } from "@/components/shared/select-field"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { nomeDoNivel, type UserRole } from "@/lib/permissoes"
import type { AtendenteItem, DepartamentoItem, UsuarioDisponivel } from "@/services/crm"

type Origem = "novo" | "existente"

export function AtendenteFormDialog({
  open,
  onOpenChange,
  atendente,
  departamentos,
  usuariosDisponiveis,
  usuarioAtualId,
  ehRoot,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  atendente?: AtendenteItem | null
  departamentos: DepartamentoItem[]
  usuariosDisponiveis: UsuarioDisponivel[]
  usuarioAtualId: string
  /** Só o Root pode criar/promover administradores; os demais criam apenas usuários padrão. */
  ehRoot: boolean
}) {
  const editando = Boolean(atendente)
  const editandoASiMesmo = atendente?.userId === usuarioAtualId
  const [pending, startTransition] = useTransition()

  const [origem, setOrigem] = useState<Origem>("novo")
  const [userId, setUserId] = useState("")
  const [nome, setNome] = useState("")
  const [username, setUsername] = useState("")
  const [senha, setSenha] = useState("")
  const [role, setRole] = useState<UserRole>("padrao")
  const [departamentoIds, setDepartamentoIds] = useState<string[]>([])
  const [ativo, setAtivo] = useState(true)

  // O diálogo é reaproveitado para criar e editar: recarrega os campos a cada abertura.
  useEffect(() => {
    if (!open) return
    setOrigem("novo")
    setUserId("")
    setNome(atendente?.nome ?? "")
    setUsername(atendente?.username ?? "")
    setSenha("")
    setRole(atendente?.role ?? "padrao")
    setDepartamentoIds(atendente?.departamentoIds ?? [])
    setAtivo(atendente?.ativo ?? true)
  }, [open, atendente])

  const vinculandoExistente = !editando && origem === "existente"

  function alternarDepartamento(id: string, marcado: boolean) {
    setDepartamentoIds((atual) => (marcado ? [...new Set([...atual, id])] : atual.filter((item) => item !== id)))
  }

  function salvar() {
    if (vinculandoExistente && !userId) {
      toast.error("Selecione o usuário que será atendente.")
      return
    }
    startTransition(async () => {
      const payload = {
        userId: vinculandoExistente ? userId : null,
        nome,
        username,
        senha,
        role,
        departamentoIds,
        ativo,
      }
      const resultado = atendente ? await updateAtendenteAction(atendente.id, payload) : await createAtendenteAction(payload)
      if (resultado.ok) {
        toast.success(resultado.message)
        onOpenChange(false)
      } else {
        toast.error(resultado.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>{editando ? "Editar atendente" : "Novo atendente"}</DialogTitle>
          <DialogDescription>
            Todo atendente é um usuário do painel (administrador ou comum). Os departamentos definem para quem a conversa pode ser transferida.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
          {!editando ? (
            <Field>
              <FieldLabel htmlFor="atendente-origem">Usuário</FieldLabel>
              <SelectField
                id="atendente-origem"
                value={origem}
                onValueChange={(valor) => setOrigem(valor === "existente" ? "existente" : "novo")}
                opcoes={[
                  { value: "novo", label: "Criar um novo usuário" },
                  {
                    value: "existente",
                    label: `Usar um usuário existente${usuariosDisponiveis.length === 0 ? " (nenhum disponível)" : ""}`,
                  },
                ]}
              />
            </Field>
          ) : null}

          {vinculandoExistente ? (
            <Field>
              <FieldLabel htmlFor="atendente-usuario">Usuário existente</FieldLabel>
              <SelectField
                id="atendente-usuario"
                value={userId}
                onValueChange={setUserId}
                placeholder={usuariosDisponiveis.length ? "Selecione um usuário" : "Todos os usuários já são atendentes"}
                disabled={usuariosDisponiveis.length === 0}
                opcoes={usuariosDisponiveis.map((usuario) => ({
                  value: usuario.id,
                  label: `${usuario.nome} (${usuario.username}) · ${nomeDoNivel(usuario.role)}`,
                }))}
              />
              <FieldDescription>
                Usuário padrão precisa ter a seção Chat liberada em Usuários para atender conversas.
              </FieldDescription>
            </Field>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="atendente-nome">Nome</FieldLabel>
                  <Input id="atendente-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Maria Souza" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="atendente-login">Login</FieldLabel>
                  <Input
                    id="atendente-login"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase())}
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="maria.souza"
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="atendente-senha">{editando ? "Nova senha" : "Senha"}</FieldLabel>
                  <Input
                    id="atendente-senha"
                    type="password"
                    autoComplete="new-password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    placeholder={editando ? "Deixe em branco para manter a atual" : "Mínimo de 8 caracteres"}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="atendente-nivel">Nível</FieldLabel>
                  <SelectField
                    id="atendente-nivel"
                    value={role}
                    onValueChange={(valor) => setRole(valor === "admin" ? "admin" : "padrao")}
                    disabled={!ehRoot || role === "root"}
                    opcoes={[
                      { value: "padrao", label: "Usuário padrão" },
                      ...(ehRoot || role === "admin" ? [{ value: "admin", label: "Administrador" }] : []),
                      ...(role === "root" ? [{ value: "root", label: "Root" }] : []),
                    ]}
                  />
                  {editandoASiMesmo ? <FieldDescription>Você está editando o próprio usuário.</FieldDescription> : null}
                </Field>
              </div>
              {!editando && role === "padrao" ? (
                <FieldDescription>O usuário padrão é criado com acesso à seção Chat. Ajuste outras seções em Usuários.</FieldDescription>
              ) : null}
            </>
          )}

          <Field>
            <FieldLabel>Departamentos</FieldLabel>
            {departamentos.length === 0 ? (
              <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
                Nenhum departamento criado ainda. Crie um na aba Departamentos para vincular este atendente.
              </p>
            ) : (
              <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                {departamentos.map((departamento) => (
                  <label
                    key={departamento.id}
                    htmlFor={`atendente-dep-${departamento.id}`}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      id={`atendente-dep-${departamento.id}`}
                      checked={departamentoIds.includes(departamento.id)}
                      onCheckedChange={(marcado) => alternarDepartamento(departamento.id, Boolean(marcado))}
                    />
                    <span className="truncate">{departamento.nome}</span>
                    {!departamento.ativo ? <span className="text-xs text-muted-foreground">(inativo)</span> : null}
                  </label>
                ))}
              </div>
            )}
          </Field>

          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <label htmlFor="atendente-ativo" className="text-sm font-medium">
                Recebe conversas
              </label>
              <FieldDescription>
                Atendente inativo não aparece na transferência, mas continua entrando no painel normalmente.
              </FieldDescription>
            </div>
            <Switch id="atendente-ativo" checked={ativo} onCheckedChange={setAtivo} />
          </div>
        </div>

        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={salvar} disabled={pending}>
            {pending ? <Spinner /> : null}
            {editando ? "Salvar alterações" : "Criar atendente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
