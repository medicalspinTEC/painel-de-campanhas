import { UsuariosManager } from "@/components/features/usuarios/usuarios-manager"
import { PageHeader } from "@/components/shared/page-header"
import { requireAdminPage } from "@/lib/session"
import { listUsers } from "@/services/users"

export const metadata = {
  title: "Usuários | Painel de Campanhas WhatsApp",
}

export default async function UsuariosPage() {
  const admin = await requireAdminPage()
  const usuarios = await listUsers()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Usuários"
        descricao="Crie, edite e exclua usuários e defina quais seções cada um pode acessar."
      />
      <UsuariosManager usuarios={usuarios} usuarioAtualId={admin.id} />
    </div>
  )
}
