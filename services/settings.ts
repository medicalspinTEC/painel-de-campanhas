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
  corPrincipal: string
  corSecundaria: string
  corTerciaria: string
}

export type AppThemeColors = Pick<Settings, "corPrincipal" | "corSecundaria" | "corTerciaria">

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
  corPrincipal: "#00815a",
  corSecundaria: "#f0f5f2",
  corTerciaria: "#e3f5ec",
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
    corPrincipal: row.corPrincipal,
    corSecundaria: row.corSecundaria,
    corTerciaria: row.corTerciaria,
  }
}

export async function getAppThemeColors(): Promise<AppThemeColors> {
  const row = await prisma.settings.findUnique({
    where: { id: ID },
    select: { corPrincipal: true, corSecundaria: true, corTerciaria: true },
  })
  return row ?? {
    corPrincipal: SETTINGS_PADRAO.corPrincipal,
    corSecundaria: SETTINGS_PADRAO.corSecundaria,
    corTerciaria: SETTINGS_PADRAO.corTerciaria,
  }
}

export async function getChatPluginAtivo(): Promise<boolean> {
  const row = await prisma.settings.findUnique({
    where: { id: ID },
    select: { chatPluginAtivo: true },
  })
  return row?.chatPluginAtivo ?? false
}

export async function setChatPluginAtivo(ativo: boolean): Promise<void> {
  await prisma.settings.upsert({
    where: { id: ID },
    create: { id: ID, chatPluginAtivo: ativo },
    update: { chatPluginAtivo: ativo },
  })
}

export async function getKanbanPluginAtivo(): Promise<boolean> {
  const row = await prisma.settings.findUnique({
    where: { id: ID },
    select: { kanbanPluginAtivo: true },
  })
  return row?.kanbanPluginAtivo ?? false
}

export async function setKanbanPluginAtivo(ativo: boolean): Promise<void> {
  await prisma.settings.upsert({
    where: { id: ID },
    create: { id: ID, kanbanPluginAtivo: ativo },
    update: { kanbanPluginAtivo: ativo },
  })
}

export async function getAssistentePluginAtivo(): Promise<boolean> {
  try {
    const row = await prisma.settings.findUnique({
      where: { id: ID },
      select: { assistentePluginAtivo: true },
    })
    return row?.assistentePluginAtivo ?? false
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2022") return false
    throw error
  }
}

export async function setAssistentePluginAtivo(ativo: boolean): Promise<void> {
  await prisma.settings.upsert({
    where: { id: ID },
    create: { id: ID, assistentePluginAtivo: ativo },
    update: { assistentePluginAtivo: ativo },
  })
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
    corPrincipal: row.corPrincipal,
    corSecundaria: row.corSecundaria,
    corTerciaria: row.corTerciaria,
  }
}
