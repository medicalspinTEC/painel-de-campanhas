import { BackupPanel } from "@/components/features/backup/backup-panel"
import { SECOES_PADRAO } from "@/lib/backup/secoes"
import { contarLinhasPorSecao, getConfigBackup, listarBackups, type ConfigBackup } from "@/services/backup"

const CONFIG_VAZIA: ConfigBackup = {
  url: "",
  temSegredo: false,
  secoes: SECOES_PADRAO,
  auto: { ativo: false, modo: "diario", intervaloHoras: 24, horario: "03:00", diaSemana: 0, proximoEm: null },
}

/**
 * Seção "Backup" da aba de Configurações. Componente de servidor: busca tudo o
 * que a tela precisa. Basta renderizá-lo dentro da página de configurações:
 *
 *   <BackupSettings />
 *
 * O acesso é o da própria página de configurações (as actions também conferem).
 */
export async function BackupSettings() {
  let migrationPendente = false
  const [config, backups, contagens] = await Promise.all([
    getConfigBackup().catch(() => {
      migrationPendente = true
      return CONFIG_VAZIA
    }),
    listarBackups().catch(() => []),
    contarLinhasPorSecao().catch(() => ({})),
  ])

  // Primeira vez: já vem com as seções de cadastro marcadas.
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
