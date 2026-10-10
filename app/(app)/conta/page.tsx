import { ContaForms } from "@/components/features/conta/conta-forms"
import { PushDispositivoCard } from "@/components/features/push/push-dispositivo-card"
import { PageHeader } from "@/components/shared/page-header"
import { requireUser } from "@/lib/session"

export const metadata = {
  title: "Minha conta | Painel de Campanhas WhatsApp",
}

export default async function ContaPage() {
  const usuario = await requireUser()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Minha conta"
        descricao="Preferências pessoais: o que você altera aqui vale só para o seu usuário."
      />
      <ContaForms
        userId={usuario.id}
        nome={usuario.nome}
        username={usuario.username}
        temaApp={usuario.temaApp}
        fotoEm={usuario.fotoEm}
      />
      <PushDispositivoCard />
    </div>
  )
}
