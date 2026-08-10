import { SettingsForm } from "@/components/features/settings/settings-form"
import { PageHeader } from "@/components/shared/page-header"
import { getSettings } from "@/services/settings"

export const metadata = {
  title: "Configurações",
}

export default async function ConfiguracoesPage() {
  const settings = await getSettings()

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        titulo="Configurações"
        descricao="Ajuste a identidade do remetente, a janela de disparo e as políticas da engine."
      />
      <SettingsForm inicial={settings} />
    </div>
  )
}
