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
  // O tema é preferência PESSOAL de cada usuário (User.temaApp) — não é gravado aqui.
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

// ---------------------------------------------------------------------------
// Marca do painel (nome + logo da sidebar)
// ---------------------------------------------------------------------------

export type AppMarca = { nome: string; logo: string | null }

export const MARCA_PADRAO: AppMarca = { nome: "Medical Spin", logo: null }

function colunaAusente(error: unknown): boolean {
  // P2022: a coluna ainda não existe (migration pendente).
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2022"
}

export async function getAppMarca(): Promise<AppMarca> {
  try {
    const row = await prisma.settings.findUnique({
      where: { id: ID },
      select: { appNome: true, appLogo: true },
    })
    return { nome: row?.appNome?.trim() || MARCA_PADRAO.nome, logo: row?.appLogo ?? null }
  } catch (error) {
    if (colunaAusente(error)) return MARCA_PADRAO
    throw error
  }
}

export async function saveAppMarca(marca: AppMarca): Promise<void> {
  await prisma.settings.upsert({
    where: { id: ID },
    create: { id: ID, appNome: marca.nome, appLogo: marca.logo },
    update: { appNome: marca.nome, appLogo: marca.logo },
  })
}

export async function getNocodePluginAtivo(): Promise<boolean> {
  try {
    const row = await prisma.settings.findUnique({
      where: { id: ID },
      select: { nocodePluginAtivo: true },
    })
    return row?.nocodePluginAtivo ?? false
  } catch (error) {
    if (colunaAusente(error)) return false
    throw error
  }
}

export async function setNocodePluginAtivo(ativo: boolean): Promise<void> {
  await prisma.settings.upsert({
    where: { id: ID },
    create: { id: ID, nocodePluginAtivo: ativo },
    update: { nocodePluginAtivo: ativo },
  })
}

export async function getCrmPluginAtivo(): Promise<boolean> {
  try {
    const row = await prisma.settings.findUnique({
      where: { id: ID },
      select: { crmPluginAtivo: true },
    })
    return row?.crmPluginAtivo ?? false
  } catch (error) {
    // Coluna ainda não existe: a migration do CRM não foi aplicada.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2022") return false
    throw error
  }
}

export async function setCrmPluginAtivo(ativo: boolean): Promise<void> {
  await prisma.settings.upsert({
    where: { id: ID },
    create: { id: ID, crmPluginAtivo: ativo },
    update: { crmPluginAtivo: ativo },
  })
}
