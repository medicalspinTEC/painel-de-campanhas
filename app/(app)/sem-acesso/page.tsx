import { ShieldAlert } from "lucide-react"

import { logoutAction } from "@/app/actions/auth"
import { LinkButton } from "@/components/shared/link-button"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { primeiraRotaPermitida } from "@/lib/permissoes"
import { requireUser } from "@/lib/session"

export const metadata = {
  title: "Sem acesso | Painel de Campanhas WhatsApp",
}

export default async function SemAcessoPage() {
  const usuario = await requireUser()
  const destino = primeiraRotaPermitida(usuario)

  return (
    <Empty className="mx-auto mt-10 max-w-md">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ShieldAlert className="size-5" aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>Você não tem acesso a esta seção</EmptyTitle>
        <EmptyDescription>
          {destino
            ? "Peça a um administrador para liberar o acesso, ou volte para uma seção disponível."
            : "Nenhuma seção foi liberada para o seu usuário ainda. Peça a um administrador para definir o seu acesso."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {destino ? <LinkButton href={destino}>Ir para uma seção liberada</LinkButton> : null}
        <form action={logoutAction}>
          <Button type="submit" variant="outline">
            Sair
          </Button>
        </form>
      </EmptyContent>
    </Empty>
  )
}
