import { UsuariosManager } from "@/components/features/usuarios/usuarios-manager"
import { PageHeader } from "@/components/shared/page-header"
import { requireGestaoUsuarios } from "@/lib/session"
import { listUsers } from "@/services/users"

export const metadata = {
  title: "Usuários | Painel de Campanhas WhatsApp",
}

export default async function UsuariosPage() {
  const ator = await requireGestaoUsuarios()
  const usuarios = await listUsers(ator)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Usuários"
        descricao={
          ator.role === "root"
            ? "Controle administradores e usuários: defina o que cada administrador pode acessar e controlar."
            : "Gerencie os usuários padrão dentro do que o Root liberou para você."
        }
      />
      <UsuariosManager
        usuarios={usuarios}
        ator={{ id: ator.id, role: ator.role, secoes: ator.secoes, poderes: ator.poderes }}
      />
    </div>
  )
}
