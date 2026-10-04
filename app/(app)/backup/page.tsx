import { BackupPanel } from "@/components/features/backup/backup-panel"
import { requireSecao } from "@/lib/session"
import { SECOES_PADRAO } from "@/lib/backup/secoes"
import { contarLinhasPorSecao, getConfigBackup, listarBackups, type ConfigBackup } from "@/services/backup"

export const metadata = {
  title: "Backup | Painel de Campanhas WhatsApp",
}

export const dynamic = "force-dynamic"

const CONFIG_VAZIA: ConfigBackup = {
  url: "",
  temSegredo: false,
  secoes: SECOES_PADRAO,
  auto: { ativo: false, modo: "diario", intervaloHoras: 24, horario: "03:00", diaSemana: 0, proximoEm: null },
}

export default async function BackupPage() {
  await requireSecao("backup")

  let migrationPendente = false
  const [config, backups, contagens] = await Promise.all([
    getConfigBackup().catch(() => {
      migrationPendente = true
      return CONFIG_VAZIA
    }),
    listarBackups().catch(() => []),
    contarLinhasPorSecao(),
  ])

  // Primeira vez: já sugere as seções de cadastro marcadas.
  const inicial = config.secoes.length === 0 && !config.url ? { ...config, secoes: SECOES_PADRAO } : config

  return (
    <BackupPanel
      configInicial={inicial}
      backupsIniciais={backups}
      contagens={contagens}
      migrationPendente={migrationPendente}
    />
  )
}
