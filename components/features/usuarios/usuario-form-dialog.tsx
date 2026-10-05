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
import {
  niveisGerenciaveis,
  nomeDoNivel,
  PODERES,
  SECOES,
  secoesQuePodeConceder,
  temPoder,
  type PoderKey,
  type SecaoKey,
  type UserRole,
} from "@/lib/permissoes"
import type { Usuario } from "@/services/users"

const GRUPOS = ["Gestão", "Acompanhamento", "Sistema"] as const
const GRUPOS_PODERES = ["Usuários", "Plugins e sistema"] as const

/** Dados do usuário logado que o formulário precisa para saber o que ele pode fazer. */
export type AtorUsuario = { id: string; role: UserRole; secoes: readonly string[]; poderes: readonly string[] }

export function UsuarioFormDialog({
  open,
  onOpenChange,
  usuario,
  ator,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  usuario?: Usuario | null
  ator: AtorUsuario
}) {
  const editando = Boolean(usuario)
  const editandoASiMesmo = usuario?.id === ator.id
  const ehRoot = ator.role === "root"
  // Administrador tem instância própria (dados separados): ao editar, não se troca entre Administrador e os demais níveis.
  const niveisOferecidos = niveisGerenciaveis(ator).filter(
    (nivel) => !usuario || (usuario.role === "admin" ? nivel === "admin" : nivel !== "admin"),
  )
  // O que este ator pode fazer neste formulário (o servidor confere tudo de novo).
  const podeEditarDados = !editando || temPoder(ator, "usuarios_editar")
  const podeDefinirSecoes = !editandoASiMesmo && (ehRoot || temPoder(ator, "usuarios_secoes"))
  const secoesConcediveis = new Set<string>(secoesQuePodeConceder(ator))
  const [pending, startTransition] = useTransition()

  const [nome, setNome] = useState("")
  const [username, setUsername] = useState("")
  const [senha, setSenha] = useState("")
  const [role, setRole] = useState<UserRole>("padrao")
  const [ativo, setAtivo] = useState(true)
  const [secoes, setSecoes] = useState<SecaoKey[]>([])
  const [poderes, setPoderes] = useState<PoderKey[]>([])

  // O diálogo é reaproveitado para criar e editar: recarrega os campos a cada abertura.
  useEffect(() => {
    if (!open) return
    setNome(usuario?.nome ?? "")
    setUsername(usuario?.username ?? "")
    setSenha("")
    setRole(usuario?.role ?? "padrao")
    setAtivo(usuario?.ativo ?? true)
    setSecoes(usuario?.secoes ?? [])
    setPoderes(usuario?.poderes ?? [])
  }, [open, usuario])

  function alternarSecao(key: SecaoKey, marcada: boolean) {
    setSecoes((atual) => (marcada ? [...new Set([...atual, key])] : atual.filter((s) => s !== key)))
  }

  function alternarPoder(key: PoderKey, marcado: boolean) {
    setPoderes((atual) => (marcado ? [...new Set([...atual, key])] : atual.filter((p) => p !== key)))
  }

  // Seções que o ator não pode mexer (ex.: o admin não acessa a seção) ficam como estão.
  function marcarTodas() {
    setSecoes((atual) => [...new Set([...atual.filter((k) => !secoesConcediveis.has(k)), ...secoesConcediveis] as SecaoKey[])])
  }

  function limparSecoes() {
    setSecoes((atual) => atual.filter((k) => !secoesConcediveis.has(k)))
  }

  function salvar() {
    startTransition(async () => {
      // `poderes` só vale para admin (e só o Root consegue defini-los: o servidor ignora o resto).
      const payload = { nome, username, senha, role, ativo, secoes, poderes: role === "admin" ? poderes : [] }
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
            {ehRoot
              ? "Root controla todos os níveis. Administradores só acessam e controlam o que você liberar; usuários padrão só enxergam as seções marcadas."
              : "Usuários padrão só enxergam as seções marcadas abaixo, dentro do que você mesmo acessa."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="usuario-nome">Nome</FieldLabel>
              <Input id="usuario-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Maria Souza" disabled={!podeEditarDados} />
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
                disabled={!podeEditarDados}
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
              disabled={!podeEditarDados}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="usuario-nivel">Nível</FieldLabel>
              <SelectField
                id="usuario-nivel"
                value={role}
                onValueChange={(valor) => setRole(valor === "root" ? "root" : valor === "admin" ? "admin" : "padrao")}
                disabled={editandoASiMesmo || niveisOferecidos.length <= 1}
                opcoes={niveisOferecidos.map((nivel) => ({ value: nivel, label: nomeDoNivel(nivel) }))}
              />
              {editandoASiMesmo ? (
                <FieldDescription>Você está editando o próprio usuário: nível, status e acesso não podem ser alterados por aqui.</FieldDescription>
              ) : null}
              {!editando && role === "admin" ? (
                <FieldDescription>
                  Cria uma instância privada para este administrador: dados, configurações e usuários próprios, sem acesso para
                  você ou para outros administradores.
                </FieldDescription>
              ) : null}
            </Field>

            <div className="flex items-start justify-between gap-4 sm:pt-6">
              <div className="flex flex-col gap-0.5">
                <label htmlFor="usuario-ativo" className="text-sm font-medium">
                  Usuário ativo
                </label>
                <span className="text-sm text-muted-foreground">Inativo perde o acesso na hora.</span>
              </div>
              <Switch id="usuario-ativo" checked={ativo} onCheckedChange={setAtivo} disabled={editandoASiMesmo || !podeEditarDados} />
            </div>
          </div>

          {role === "root" ? (
            <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
              Root acessa todas as seções e controla todos os níveis: cria, edita e exclui administradores e usuários, e
              define o que cada administrador pode acessar e controlar.
            </p>
          ) : (
            <>
              <Field>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel>{role === "admin" ? "Seções que o administrador acessa" : "Seções liberadas"}</FieldLabel>
                  {podeDefinirSecoes ? (
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={marcarTodas}>
                        Marcar todas
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={limparSecoes}>
                        Limpar
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col gap-4 rounded-lg border p-3">
                  {GRUPOS.map((grupo) => (
                    <div key={grupo} className="flex flex-col gap-2">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{grupo}</span>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {SECOES.filter((s) => s.grupo === grupo).map((secao) => {
                          const desabilitada = !podeDefinirSecoes || !secoesConcediveis.has(secao.key)
                          return (
                            <label
                              key={secao.key}
                              htmlFor={`secao-${secao.key}`}
                              className={`flex items-center gap-2 text-sm ${desabilitada ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                            >
                              <Checkbox
                                id={`secao-${secao.key}`}
                                checked={secoes.includes(secao.key)}
                                disabled={desabilitada}
                                onCheckedChange={(marcada) => alternarSecao(secao.key, Boolean(marcada))}
                              />
                              {secao.label}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <FieldDescription>
                  {role === "admin"
                    ? "Também é o limite do que este administrador poderá liberar para usuários padrão."
                    : !ehRoot && !podeDefinirSecoes
                      ? "Você não tem permissão para definir seções: o usuário será criado sem acesso a nenhuma."
                      : !ehRoot
                        ? "Você só pode liberar seções que você mesmo acessa; as demais ficam como estão."
                        : "Todo usuário acessa a própria conta (nome, senha e tema), independente das seções."}
                </FieldDescription>
              </Field>

              {role === "admin" ? (
                <Field>
                  <FieldLabel>O que o administrador pode controlar</FieldLabel>
                  <div className="flex flex-col gap-4 rounded-lg border p-3">
                    {GRUPOS_PODERES.map((grupo) => (
                      <div key={grupo} className="flex flex-col gap-2">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{grupo}</span>
                        <div className="flex flex-col gap-2.5">
                          {PODERES.filter((p) => p.grupo === grupo).map((poder) => (
                            <label key={poder.key} htmlFor={`poder-${poder.key}`} className="flex cursor-pointer items-start gap-2 text-sm">
                              <Checkbox
                                id={`poder-${poder.key}`}
                                className="mt-0.5"
                                checked={poderes.includes(poder.key)}
                                disabled={editandoASiMesmo}
                                onCheckedChange={(marcado) => alternarPoder(poder.key, Boolean(marcado))}
                              />
                              <span className="flex flex-col gap-0.5">
                                <span>{poder.label}</span>
                                <span className="text-xs text-muted-foreground">{poder.descricao}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <FieldDescription>
                    Administradores nunca controlam outros administradores nem o Root, e não alteram o próprio acesso.
                  </FieldDescription>
                </Field>
              ) : null}
            </>
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
