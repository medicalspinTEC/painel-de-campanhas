import { BackupSettings } from "@/components/features/backup/backup-settings"
import { requireSecao } from "@/lib/session"

export const metadata = {
  title: "Backup | Painel de Campanhas WhatsApp",
}

export const dynamic = "force-dynamic"

/**
 * Mesma tela da seção de Backup em Configurações (backup + restauração).
 * O acesso segue o de Configurações: não existe uma seção "backup" nas permissões.
 */
export default async function BackupPage() {
  await requireSecao("configuracoes")
  return <BackupSettings />
}
