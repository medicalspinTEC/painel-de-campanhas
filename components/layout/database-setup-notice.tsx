import { Database, TriangleAlert } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface DatabaseSetupNoticeProps {
  /** Mensagem do erro de conexão, quando a URL existe mas falhou. */
  erro?: string
}

/**
 * Exibida quando o banco não está acessível. Sem isso, cada página do painel
 * quebraria com um erro de conexão bruto do Postgres.
 */
export function DatabaseSetupNotice({ erro }: DatabaseSetupNoticeProps) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col justify-center gap-6 p-6">
      <div className="flex flex-col gap-3">
        <span className="flex size-11 items-center justify-center rounded-lg border bg-muted">
          <Database className="size-5 text-muted-foreground" aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Conecte o banco de dados</h1>
        <p className="text-muted-foreground leading-relaxed">
          O painel agora usa Prisma com Postgres. Configure a variável{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">DATABASE_URL</code> para começar a
          cadastrar leads e campanhas.
        </p>
      </div>

      {erro ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-destructive" aria-hidden="true" />
              Falha ao conectar
            </CardTitle>
            <CardDescription>A URL está definida, mas a conexão não foi estabelecida.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">{erro}</pre>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Como configurar</CardTitle>
          <CardDescription>Duas opções, ambas levam ao mesmo resultado.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 text-sm leading-relaxed">
          <div className="flex flex-col gap-1.5">
            <h2 className="font-medium">1. Integração no v0</h2>
            <p className="text-muted-foreground">
              Abra as configurações no canto superior direito e conecte um Postgres. A{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">DATABASE_URL</code> é preenchida
              automaticamente.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <h2 className="font-medium">2. Banco próprio</h2>
            <p className="text-muted-foreground">
              Adicione a connection string em Vars, nas configurações do projeto.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 border-t pt-4">
            <h2 className="font-medium">Depois, crie as tabelas</h2>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">pnpm db:deploy</pre>
            <p className="text-muted-foreground">
              Aplica a migration inicial com as tabelas de leads, campanhas, mensagens e eventos.
            </p>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
