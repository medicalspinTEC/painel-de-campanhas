"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { createUserAction, updateUserAction } from "@/app/actions/users"
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
import { SECOES, type SecaoKey, type UserRole } from "@/lib/permissoes"
import type { Usuario } from "@/services/users"

const GRUPOS = ["Gestão", "Acompanhamento", "Sistema"] as const

export function UsuarioFormDialog({
  open,
  onOpenChange,
  usuario,
  usuarioAtualId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  usuario?: Usuario | null
  usuarioAtualId: string
}) {
  const editando = Boolean(usuario)
  const editandoASiMesmo = usuario?.id === usuarioAtualId
  const [pending, startTransition] = useTransition()

  const [nome, setNome] = useState("")
  const [username, setUsername] = useState("")
  const [senha, setSenha] = useState("")
  const [role, setRole] = useState<UserRole>("padrao")
  const [ativo, setAtivo] = useState(true)
  const [secoes, setSecoes] = useState<SecaoKey[]>([])

  // O diálogo é reaproveitado para criar e editar: recarrega os campos a cada abertura.
  useEffect(() => {
    if (!open) return
    setNome(usuario?.nome ?? "")
    setUsername(usuario?.username ?? "")
    setSenha("")
    setRole(usuario?.role ?? "padrao")
    setAtivo(usuario?.ativo ?? true)
    setSecoes(usuario?.secoes ?? [])
  }, [open, usuario])

  function alternarSecao(key: SecaoKey, marcada: boolean) {
    setSecoes((atual) => (marcada ? [...new Set([...atual, key])] : atual.filter((s) => s !== key)))
  }

  function salvar() {
    startTransition(async () => {
      const payload = { nome, username, senha, role, ativo, secoes }
      const resultado = usuario ? await updateUserAction(usuario.id, payload) : await createUserAction(payload)
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
          <DialogTitle>{editando ? "Editar usuário" : "Novo usuário"}</DialogTitle>
          <DialogDescription>
            Administradores têm acesso total. Usuários padrão só enxergam as seções marcadas abaixo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="usuario-nome">Nome</FieldLabel>
              <Input id="usuario-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Maria Souza" />
            </Field>
            <Field>
              <FieldLabel htmlFor="usuario-login">Login</FieldLabel>
              <Input
                id="usuario-login"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                autoCapitalize="none"
                spellCheck={false}
                placeholder="maria.souza"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="usuario-senha">{editando ? "Nova senha" : "Senha"}</FieldLabel>
            <Input
              id="usuario-senha"
              type="password"
              autoComplete="new-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder={editando ? "Deixe em branco para manter a atual" : "Mínimo de 8 caracteres"}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="usuario-nivel">Nível</FieldLabel>
              <SelectField
                id="usuario-nivel"
                value={role}
                onValueChange={(valor) => setRole(valor === "admin" ? "admin" : "padrao")}
                opcoes={[
                  { value: "padrao", label: "Usuário padrão" },
                  { value: "admin", label: "Administrador" },
                ]}
              />
              {editandoASiMesmo ? (
                <FieldDescription>Você está editando o próprio usuário.</FieldDescription>
              ) : null}
            </Field>

            <div className="flex items-start justify-between gap-4 sm:pt-6">
              <div className="flex flex-col gap-0.5">
                <label htmlFor="usuario-ativo" className="text-sm font-medium">
                  Usuário ativo
                </label>
                <span className="text-sm text-muted-foreground">Inativo perde o acesso na hora.</span>
              </div>
              <Switch id="usuario-ativo" checked={ativo} onCheckedChange={setAtivo} />
            </div>
          </div>

          {role === "admin" ? (
            <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
              Administradores acessam todas as seções, criam, editam e excluem usuários e definem o que cada um pode ver.
            </p>
          ) : (
            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel>Seções liberadas</FieldLabel>
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSecoes(SECOES.map((s) => s.key))}>
                    Marcar todas
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSecoes([])}>
                    Limpar
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-4 rounded-lg border p-3">
                {GRUPOS.map((grupo) => (
                  <div key={grupo} className="flex flex-col gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{grupo}</span>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {SECOES.filter((s) => s.grupo === grupo).map((secao) => (
                        <label key={secao.key} htmlFor={`secao-${secao.key}`} className="flex cursor-pointer items-center gap-2 text-sm">
                          <Checkbox
                            id={`secao-${secao.key}`}
                            checked={secoes.includes(secao.key)}
                            onCheckedChange={(marcada) => alternarSecao(secao.key, Boolean(marcada))}
                          />
                          {secao.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <FieldDescription>
                Todo usuário acessa a própria conta (nome, senha e tema), independente das seções.
              </FieldDescription>
            </Field>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={salvar} disabled={pending}>
            {pending ? <Spinner /> : null}
            {editando ? "Salvar alterações" : "Criar usuário"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
