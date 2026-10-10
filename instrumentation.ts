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

  // Bots de follow-up dos departamentos: envia o template quando o lead fica o tempo configurado sem responder.
  let ultimoErroFollowUp = ""
  const tickFollowUp = async () => {
    try {
      const { processarFollowUps } = await import("@/services/followup")
      const resultado = await processarFollowUps()
      ultimoErroFollowUp = ""
      if (resultado.enviados) console.log("[v0] follow-ups enviados pelos bots:", resultado)
    } catch (error) {
      // Só loga quando o erro muda (ex.: migration ainda não aplicada), para não encher o log a cada minuto.
      const mensagem = error instanceof Error ? error.message : String(error)
      if (mensagem !== ultimoErroFollowUp) console.error("[v0] falha na varredura de follow-up:", error)
      ultimoErroFollowUp = mensagem
    }
  }
  setTimeout(tickFollowUp, 25_000)
  setInterval(tickFollowUp, 60_000)

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

  // Notificações push agendadas: envia as que já chegaram na hora (varredura a cada 30 s).
  let ultimoErroPush = ""
  const tickPush = async () => {
    try {
      const { manutencaoPush } = await import("@/services/push")
      const resultado = await manutencaoPush()
      ultimoErroPush = ""
      if (resultado.enviadas || resultado.interrompidas) console.log("[v0] notificações push:", resultado)
    } catch (error) {
      // Só loga quando o erro muda (ex.: migration ainda não aplicada), para não encher o log a cada 30s.
      const mensagem = error instanceof Error ? error.message : String(error)
      if (mensagem !== ultimoErroPush) console.error("[v0] falha na rotina de notificações push:", error)
      ultimoErroPush = mensagem
    }
  }
  setTimeout(tickPush, 35_000)
  setInterval(tickPush, 30_000)

  // Mensagens de voz do chat ficam numa pasta do servidor (não no banco) e são apagadas
  // sozinhas depois de AUDIO_RETENTION_DAYS dias (padrão 30). Varredura a cada hora.
  let ultimoErroAudios = ""
  const tickAudios = async () => {
    try {
      const { limparAudiosExpirados } = await import("@/lib/audio-storage")
      const resultado = await limparAudiosExpirados()
      // Imagens/arquivos recebidos que ninguém baixou (os baixados já se apagam sozinhos).
      const { limparArquivosExpirados } = await import("@/lib/arquivo-storage")
      const arquivos = await limparArquivosExpirados()
      if (arquivos.removidos) console.log("[v0] limpeza de arquivos recebidos:", arquivos)
      // Anexos do chat interno (equipe) que ninguém baixou.
      const { limparAnexosInternosExpirados } = await import("@/lib/interno-storage")
      const internos = await limparAnexosInternosExpirados()
      if (internos.removidos) console.log("[v0] limpeza de anexos do chat interno:", internos)
      // Anexos de campanha: 30 dias com a campanha ativa/pausada, 10 dias quando ela não está
      // (a exclusão da campanha apaga na hora, em `deleteCampaign`). Vale para todas as instâncias.
      const { aplicarRetencaoAnexos } = await import("@/lib/campanha-anexo-storage")
      const { prismaGlobal } = await import("@/lib/prisma")
      const comAnexo = await prismaGlobal.campaignMessage.findMany({
        where: { anexoId: { not: null } },
        select: { anexoId: true, campanha: { select: { status: true, atualizadoEm: true } } },
      })
      const retencao = await aplicarRetencaoAnexos(
        comAnexo.map((m) => ({
          anexoId: m.anexoId as string,
          campanhaStatus: m.campanha.status,
          campanhaAtualizadaEm: m.campanha.atualizadoEm,
        })),
      )
      if (retencao.expirados || retencao.orfaos) console.log("[v0] limpeza de anexos de campanha:", retencao)
      ultimoErroAudios = ""
      if (resultado.removidos) console.log("[v0] limpeza de áudios do chat:", resultado)
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : String(error)
      if (mensagem !== ultimoErroAudios) console.error("[v0] falha na limpeza de áudios do chat:", error)
      ultimoErroAudios = mensagem
    }
  }
  setTimeout(tickAudios, 60_000)
  setInterval(tickAudios, 60 * 60 * 1000)

  console.log(`[v0] engine de campanhas ativa (intervalo ${intervaloMs}ms).`)
}
