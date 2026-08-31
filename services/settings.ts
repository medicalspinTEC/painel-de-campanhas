import { prisma } from "@/lib/prisma"
import { emitWebhookEvent } from "@/services/webhooks"

export type Settings = {
  remetente: string
  numero: string
  assinatura: string
  fuso: string
  janelaInicio: string
  janelaFim: string
  limiteDiario: number
  maxEnviosPorPeriodo: number
  periodoEsperaValor: number
  periodoEsperaUnidade: string
  respeitarJanela: boolean
  pausarNoFimDeSemana: boolean
  notificarFalhas: boolean
}

/** Id fixo da linha única de configurações. */
const ID = "default"

export const SETTINGS_PADRAO: Settings = {
  remetente: "Engine Follow-up",
  numero: "",
  assinatura: "Equipe Engine · responda com SAIR para não receber mais mensagens.",
  fuso: "America/Sao_Paulo",
  janelaInicio: "09:00",
  janelaFim: "20:00",
  limiteDiario: 300,
  maxEnviosPorPeriodo: 50,
  periodoEsperaValor: 1,
  periodoEsperaUnidade: "horas",
  respeitarJanela: true,
  pausarNoFimDeSemana: true,
  notificarFalhas: true,
}

export async function getSettings(): Promise<Settings> {
  const row = await prisma.settings.findUnique({ where: { id: ID } })
  // Antes do primeiro salvamento não existe linha; devolvemos os padrões.
  if (!row) return SETTINGS_PADRAO
  return {
    remetente: row.remetente,
    numero: row.numero,
    assinatura: row.assinatura,
    fuso: row.fuso,
    janelaInicio: row.janelaInicio,
    janelaFim: row.janelaFim,
    limiteDiario: row.limiteDiario,
    maxEnviosPorPeriodo: row.maxEnviosPorPeriodo,
    periodoEsperaValor: row.periodoEsperaValor,
    periodoEsperaUnidade: row.periodoEsperaUnidade,
    respeitarJanela: row.respeitarJanela,
    pausarNoFimDeSemana: row.pausarNoFimDeSemana,
    notificarFalhas: row.notificarFalhas,
  }
}

export async function saveSettings(input: Settings): Promise<Settings> {
  const row = await prisma.settings.upsert({
    where: { id: ID },
    create: { id: ID, ...input },
    update: input,
  })

  await emitWebhookEvent("configuracoes.atualizadas", { configuracoes: input })

  return {
    remetente: row.remetente,
    numero: row.numero,
    assinatura: row.assinatura,
    fuso: row.fuso,
    janelaInicio: row.janelaInicio,
    janelaFim: row.janelaFim,
    limiteDiario: row.limiteDiario,
    maxEnviosPorPeriodo: row.maxEnviosPorPeriodo,
    periodoEsperaValor: row.periodoEsperaValor,
    periodoEsperaUnidade: row.periodoEsperaUnidade,
    respeitarJanela: row.respeitarJanela,
    pausarNoFimDeSemana: row.pausarNoFimDeSemana,
    notificarFalhas: row.notificarFalhas,
  }
}
