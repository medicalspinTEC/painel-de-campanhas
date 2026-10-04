import { BackupSettings } from "@/components/features/backup/backup-settings"
import { MarcaForm } from "@/components/features/settings/marca-form"
import { SettingsForm } from "@/components/features/settings/settings-form"
import { PageHeader } from "@/components/shared/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { getAppMarca, getSettings } from "@/services/settings"
import { requireSecao } from "@/lib/session"

export const metadata = {
  title: "Configurações | Painel de Campanhas WhatsApp",
}

export default async function ConfiguracoesPage() {
  await requireSecao("configuracoes")
  const [settings, marca] = await Promise.all([getSettings(), getAppMarca()])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Configurações"
        descricao="Ajuste a identidade do remetente, a janela de disparo e as políticas da engine."
      />
      <MarcaForm inicial={marca} />
      <SettingsForm inicial={settings} />
      <Card id="backup">
        <CardContent>
          <BackupSettings />
        </CardContent>
      </Card>
    </div>
  )
}
