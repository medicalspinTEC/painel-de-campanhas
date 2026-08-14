import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { Zap } from "lucide-react"

import { LoginForm } from "@/components/features/auth/login-form"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function LoginPage() {
  // Se já houver sessão válida, não faz sentido mostrar o formulário.
  const store = await cookies()
  const usuario = await verifySessionToken(store.get(SESSION_COOKIE)?.value)
  if (usuario) redirect("/dashboard")

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Zap className="size-5" />
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold leading-tight">Engine de Follow-up</h1>
            <p className="text-sm text-muted-foreground text-balance">
              Painel de campanhas automáticas no WhatsApp
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Entrar</CardTitle>
            <CardDescription>Acesse o painel com suas credenciais.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Acesso restrito à equipe autorizada.
        </p>
      </div>
    </main>
  )
}
