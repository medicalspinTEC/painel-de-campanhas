/*
 * Timer interno da engine de disparo.
 *
 * O servidor Next roda como um processo longo (Docker `node server.js`), então
 * agendamos aqui uma varredura periódica que envia as mensagens devidas de cada
 * campanha. Assim o fluxo funciona out-of-the-box, sem depender de um cron
 * externo. Para escalar em múltiplas instâncias, desative este timer
 * (CAMPAIGN_ENGINE_DISABLED=1) e acione `POST /api/cron` por um agendador único.
 */
// Fixa o fuso do processo em horário do Brasil já no carregamento do módulo
// (roda antes de qualquer renderização ou tick da engine). Isso garante que
// `new Date()`, `setHours`, `getHours` e as formatações de data usem sempre o
// horário de São Paulo, mesmo quando o servidor está em UTC. O ideal é que o
// TZ já venha do ambiente (Dockerfile/compose); aqui é a rede de segurança para
// qualquer plataforma que não o defina.
if (!process.env.TZ) {
  process.env.TZ = "America/Sao_Paulo"
}

export async function register() {
  // Só roda no runtime Node (não no Edge) e uma única vez por processo.
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (process.env.CAMPAIGN_ENGINE_DISABLED === "1") return

  const globalRef = globalThis as typeof globalThis & { __campaignEngineStarted?: boolean }
  if (globalRef.__campaignEngineStarted) return
  globalRef.__campaignEngineStarted = true

  const intervaloMs = Math.max(15_000, Number(process.env.CAMPAIGN_ENGINE_INTERVAL_MS ?? 60_000))

  const tick = async () => {
    try {
      const { processDueMessages } = await import("@/services/campaign-engine")
      const resultado = await processDueMessages()
      if (resultado.enviados || resultado.reiniciados || resultado.encerrados) {
        console.log("[v0] engine de campanhas:", resultado)
      }
    } catch (error) {
      console.error("[v0] falha no tick da engine de campanhas:", error)
    }
  }

  // Pequeno atraso para o servidor terminar de subir antes do primeiro tick.
  setTimeout(tick, 10_000)
  setInterval(tick, intervaloMs)

  // Manutenção do No Code: apaga execuções com mais de 24h e reenvia ao webhook as entregas que falharam.
  let ultimoErroNoCode = ""
  const tickNoCode = async () => {
    try {
      const { manutencaoNoCode } = await import("@/services/nocode-webhook-execucoes")
      const resultado = await manutencaoNoCode()
      ultimoErroNoCode = ""
      if (resultado.enviadas || resultado.falhas) console.log("[v0] webhook de execuções (No Code):", resultado)
    } catch (error) {
      // Só loga quando o erro muda (ex.: migration ainda não aplicada), para não encher o log a cada 30s.
      const mensagem = error instanceof Error ? error.message : String(error)
      if (mensagem !== ultimoErroNoCode) console.error("[v0] falha na manutenção do No Code:", error)
      ultimoErroNoCode = mensagem
    }
  }
  setTimeout(tickNoCode, 20_000)
  setInterval(tickNoCode, 30_000)

  // Backup automático para o webhook externo: dispara na hora marcada e repete os que falharam.
  let ultimoErroBackup = ""
  const tickBackup = async () => {
    try {
      const { manutencaoBackup } = await import("@/services/backup")
      const resultado = await manutencaoBackup()
      ultimoErroBackup = ""
      if (resultado.iniciado || resultado.retentados) console.log("[v0] backup automático:", resultado)
    } catch (error) {
      // Só loga quando o erro muda (ex.: migration ainda não aplicada), para não encher o log a cada 60s.
      const mensagem = error instanceof Error ? error.message : String(error)
      if (mensagem !== ultimoErroBackup) console.error("[v0] falha na rotina de backup:", error)
      ultimoErroBackup = mensagem
    }
  }
  setTimeout(tickBackup, 30_000)
  setInterval(tickBackup, 60_000)

  console.log(`[v0] engine de campanhas ativa (intervalo ${intervaloMs}ms).`)
}
