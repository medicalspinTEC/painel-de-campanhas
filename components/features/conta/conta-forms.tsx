"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { alterarMinhaSenhaAction, saveMeuNomeAction, saveMeuTemaAction } from "@/app/actions/users"
import { TemaPicker } from "@/components/features/settings/tema-picker"
import { aplicarTemaNoDocumento } from "@/components/layout/app-theme-colors"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { SENHA_MIN } from "@/lib/senha"
import type { TemaApp } from "@/lib/temas"

export function ContaForms({
  nome: nomeInicial,
  username,
  temaApp,
}: {
  nome: string
  username: string
  temaApp: TemaApp
}) {
  const router = useRouter()
  const [pendingNome, startNome] = useTransition()
  const [pendingTema, startTema] = useTransition()
  const [pendingSenha, startSenha] = useTransition()

  const [nome, setNome] = useState(nomeInicial)
  const [tema, setTema] = useState<TemaApp>(temaApp)
  const [temaSalvo, setTemaSalvo] = useState<TemaApp>(temaApp)
  const [senhaAtual, setSenhaAtual] = useState("")
  const [novaSenha, setNovaSenha] = useState("")
  const [confirmacao, setConfirmacao] = useState("")

  // Pré-visualiza o tema na hora; se sair sem salvar, volta ao tema salvo.
  useEffect(() => {
    aplicarTemaNoDocumento(tema)
    return () => aplicarTemaNoDocumento(temaSalvo)
  }, [tema, temaSalvo])

  function salvarNome() {
    startNome(async () => {
      const r = await saveMeuNomeAction(nome)
      if (r.ok) {
        toast.success(r.message)
        router.refresh()
      } else toast.error(r.message)
    })
  }

  function salvarTema() {
    startTema(async () => {
      const r = await saveMeuTemaAction(tema)
      if (r.ok) {
        setTemaSalvo(tema)
        toast.success(r.message)
        router.refresh()
      } else toast.error(r.message)
    })
  }

  function salvarSenha() {
    if (novaSenha !== confirmacao) {
      toast.error("A confirmação não confere com a nova senha.")
      return
    }
    startSenha(async () => {
      const r = await alterarMinhaSenhaAction(senhaAtual, novaSenha)
      if (r.ok) {
        toast.success(r.message)
        setSenhaAtual("")
        setNovaSenha("")
        setConfirmacao("")
      } else toast.error(r.message)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Perfil</CardTitle>
          <CardDescription>Seu login é {username}. Apenas um administrador pode alterá-lo.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field className="max-w-md">
            <FieldLabel htmlFor="conta-nome">Nome</FieldLabel>
            <Input id="conta-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </Field>
          <div>
            <Button onClick={salvarNome} disabled={pendingNome || nome.trim() === nomeInicial}>
              {pendingNome ? <Spinner /> : null}
              Salvar nome
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tema do aplicativo</CardTitle>
          <CardDescription>
            O tema vale só para você: outros usuários continuam com o tema que escolheram. Para alternar entre claro e
            escuro, use o botão no topo da página.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <TemaPicker valor={tema} onChange={setTema} />
          <div>
            <Button onClick={salvarTema} disabled={pendingTema || tema === temaSalvo}>
              {pendingTema ? <Spinner /> : null}
              Salvar tema
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alterar senha</CardTitle>
          <CardDescription>Use pelo menos {SENHA_MIN} caracteres.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid max-w-2xl gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="senha-atual">Senha atual</FieldLabel>
              <Input
                id="senha-atual"
                type="password"
                autoComplete="current-password"
                value={senhaAtual}
                onChange={(e) => setSenhaAtual(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="senha-nova">Nova senha</FieldLabel>
              <Input
                id="senha-nova"
                type="password"
                autoComplete="new-password"
                value={novaSenha}
                onChange={(e) => setNovaSenha(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="senha-confirmacao">Confirmar</FieldLabel>
              <Input
                id="senha-confirmacao"
                type="password"
                autoComplete="new-password"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
              />
            </Field>
          </div>
          <FieldDescription>Você continua conectado neste navegador após trocar a senha.</FieldDescription>
          <div>
            <Button onClick={salvarSenha} disabled={pendingSenha || !senhaAtual || !novaSenha}>
              {pendingSenha ? <Spinner /> : null}
              Alterar senha
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
