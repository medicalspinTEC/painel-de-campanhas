import { prisma } from "@/lib/prisma"
import { workspaceAtualId } from "@/lib/workspace-context"
import { PLUGINS_TODOS_DESATIVADOS, PluginDesativadoError, type PluginKey, type PluginsAtivos } from "@/lib/plugins"
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
  const row = await prisma.settings.findUnique({ where: { workspaceId: await workspaceAtualId() } })
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

/**
 * Estado de TODOS os plugins da instância atual, numa só consulta. É a fonte usada pelas
 * checagens centrais (`lib/session.ts`, rotas públicas, rotinas em segundo plano).
 * Coluna ausente (migration pendente) conta como plugin desativado.
 */
export async function getPluginsAtivos(): Promise<PluginsAtivos> {
  try {
    const row = await prisma.settings.findUnique({
      where: { workspaceId: await workspaceAtualId() },
      select: {
        chatPluginAtivo: true,
        kanbanPluginAtivo: true,
        assistentePluginAtivo: true,
        nocodePluginAtivo: true,
        crmPluginAtivo: true,
      },
    })
    if (!row) return { ...PLUGINS_TODOS_DESATIVADOS }
    return {
      chat: row.chatPluginAtivo ?? false,
      kanban: row.kanbanPluginAtivo ?? false,
      assistente: row.assistentePluginAtivo ?? false,
      nocode: row.nocodePluginAtivo ?? false,
      crm: row.crmPluginAtivo ?? false,
    }
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2022") {
      return { ...PLUGINS_TODOS_DESATIVADOS }
    }
    throw error
  }
}

export async function isPluginAtivo(plugin: PluginKey): Promise<boolean> {
  return (await getPluginsAtivos())[plugin]
}

/** Para serviços e ações: interrompe a operação quando o plugin está desativado. */
export async function exigirPlugin(...plugins: PluginKey[]): Promise<void> {
  const ativos = await getPluginsAtivos()
  for (const plugin of plugins) {
    if (!ativos[plugin]) throw new PluginDesativadoError(plugin)
  }
}

export async function getChatPluginAtivo(): Promise<boolean> {
  const row = await prisma.settings.findUnique({
    where: { workspaceId: await workspaceAtualId() },
    select: { chatPluginAtivo: true },
  })
  return row?.chatPluginAtivo ?? false
}

export async function setChatPluginAtivo(ativo: boolean): Promise<void> {
  await prisma.settings.upsert({
    where: { workspaceId: await workspaceAtualId() },
    create: { chatPluginAtivo: ativo },
    update: { chatPluginAtivo: ativo },
  })
}

export async function getKanbanPluginAtivo(): Promise<boolean> {
  const row = await prisma.settings.findUnique({
    where: { workspaceId: await workspaceAtualId() },
    select: { kanbanPluginAtivo: true },
  })
  return row?.kanbanPluginAtivo ?? false
}

export async function setKanbanPluginAtivo(ativo: boolean): Promise<void> {
  await prisma.settings.upsert({
    where: { workspaceId: await workspaceAtualId() },
    create: { kanbanPluginAtivo: ativo },
    update: { kanbanPluginAtivo: ativo },
  })
}

export async function getAssistentePluginAtivo(): Promise<boolean> {
  try {
    const row = await prisma.settings.findUnique({
      where: { workspaceId: await workspaceAtualId() },
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
    where: { workspaceId: await workspaceAtualId() },
    create: { assistentePluginAtivo: ativo },
    update: { assistentePluginAtivo: ativo },
  })
}

export async function saveSettings(input: Settings): Promise<Settings> {
  // O tema é preferência PESSOAL de cada usuário (User.temaApp) — não é gravado aqui.
  const row = await prisma.settings.upsert({
    where: { workspaceId: await workspaceAtualId() },
    create: { ...input },
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
      where: { workspaceId: await workspaceAtualId() },
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
    where: { workspaceId: await workspaceAtualId() },
    create: { appNome: marca.nome, appLogo: marca.logo },
    update: { appNome: marca.nome, appLogo: marca.logo },
  })
}

export async function getNocodePluginAtivo(): Promise<boolean> {
  try {
    const row = await prisma.settings.findUnique({
      where: { workspaceId: await workspaceAtualId() },
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
    where: { workspaceId: await workspaceAtualId() },
    create: { nocodePluginAtivo: ativo },
    update: { nocodePluginAtivo: ativo },
  })
}

export async function getCrmPluginAtivo(): Promise<boolean> {
  try {
    const row = await prisma.settings.findUnique({
      where: { workspaceId: await workspaceAtualId() },
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
    where: { workspaceId: await workspaceAtualId() },
    create: { crmPluginAtivo: ativo },
    update: { crmPluginAtivo: ativo },
  })
}
