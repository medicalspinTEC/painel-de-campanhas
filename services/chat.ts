import { arquivoExiste, lerLinhaDeArquivo, type ArquivoMeta } from "@/lib/arquivo-storage"
import { audioExiste } from "@/lib/audio-storage"
import { listBotsPorLead, type BotConversaInfo } from "@/services/bot-estado"
import { listarResumoFollowUpPorLead, type FollowUpResumo } from "@/services/followup"
import { prisma } from "@/lib/prisma"
import { workspaceAtualId } from "@/lib/workspace-context"
import { listAtendimentosPorLead, type ChatAtendimento } from "@/services/crm"
import { getCrmPluginAtivo } from "@/services/settings"

const TIPOS_DE_MENSAGEM = ["mensagem_enviada", "resposta"] as const
const LIMITE_EVENTOS_RECENTES = 1000
const LIMITE_MENSAGENS_CONVERSA = 250

export interface ChatMessage {
  id: string
  lado: "lead" | "equipe" | "interno"
  texto: string
  data: string
  campanhaNome: string | null
  /** Só em notas internas: quem escreveu (nulo em notas automáticas do sistema). */
  autor?: string | null
  /**
   * Só em mensagens de voz: o áudio fica numa pasta do servidor (nunca no banco) e some após o
   * período de retenção. `disponivel: false` = o arquivo já foi apagado.
   */
  audio?: { id: string; disponivel: boolean } | null
  /**
   * Só em imagens/arquivos recebidos: ficam numa pasta temporária do servidor, sem prévia, e são
   * apagados assim que alguém baixa. `disponivel: false` = já baixado (ou expirado) e removido.
   */
  arquivo?: (ArquivoMeta & { disponivel: boolean; legenda: string | null }) | null
}

export interface ChatConversation {
  id: string
  nome: string
  telefone: string
  produto: string
  marca: string
  persona: string
  regiao: string
  negocio: string | null
  atividade: string | null
  status: string
  campanhasNomes: string[]
  atualizadoEm: string
  ultimaMensagem: ChatMessage | null
  /** Plugin CRM: responsável pela conversa. Sempre nulo com o plugin desativado. */
  atendimento: ChatAtendimento | null
  /**
   * Plugin CRM: estado do bot nesta conversa. Nulo = o bot nunca interagiu nela (ou o plugin está
   * desativado). `ativo: false` = pausado porque um humano assumiu; só uma pessoa o reativa.
   */
  bot: BotConversaInfo | null
  /**
   * Plugin CRM: o departamento da conversa tem bot de follow-up. Nulo = não tem (ou o plugin está
   * desativado).
   */
  followUp: FollowUpResumo | null
}

export interface ChatInboxSnapshot {
  conversas: ChatConversation[]
  mensagens: ChatMessage[]
  conversaSelecionadaId: string | null
}

function extrairTexto(detalhes: string | null, tipo: string): string {
  const prefixo = tipo === "resposta" ? "Resposta:" : "Mensagem:"
  const valor = (detalhes ?? "").trim()
  if (!valor.startsWith(prefixo)) return valor

  const conteudo = valor.slice(prefixo.length).trim()
  const entreAspas = conteudo.match(/^"([\s\S]*)"\.?(?:\r?\n|$)/)
  return entreAspas?.[1] ?? conteudo.replace(/^"|"$/g, "")
}

/** Mensagens de voz guardam o id do arquivo numa linha `Audio: <id>` dos detalhes do evento. */
function extrairAudio(detalhes: string | null): ChatMessage["audio"] {
  const id = detalhes?.match(/(?:^|\n)Audio:\s*([0-9a-f-]{36}\.[a-z0-9]{3,4})\s*$/)?.[1]
  return id ? { id, disponivel: audioExiste(id) } : null
}

function extrairArquivo(detalhes: string | null, texto: string): ChatMessage["arquivo"] {
  const meta = lerLinhaDeArquivo(detalhes)
  if (!meta) return null
  const icone = meta.tipo === "imagem" ? "🖼️" : meta.tipo === "video" ? "🎬" : "📎"
  const marcador = `${icone} ${meta.nome}`
  return { ...meta, disponivel: arquivoExiste(meta.id), legenda: texto && texto !== marcador ? texto : null }
}

function mapearMensagem(evento: {
  id: string
  tipo: string
  detalhes: string | null
  data: Date | string
  campanha: { nome: string } | null
}): ChatMessage {
  const texto = extrairTexto(evento.detalhes, evento.tipo)
  return {
    id: evento.id,
    lado: evento.tipo === "resposta" ? "lead" : "equipe",
    texto,
    data: new Date(evento.data).toISOString(),
    campanhaNome: evento.campanha?.nome ?? null,
    audio: extrairAudio(evento.detalhes),
    arquivo: extrairArquivo(evento.detalhes, texto),
  }
}

function mapearNota(nota: { id: string; texto: string; data: Date; autor: string | null }): ChatMessage {
  return {
    id: nota.id,
    lado: "interno",
    texto: nota.texto,
    data: nota.data.toISOString(),
    campanhaNome: null,
    autor: nota.autor,
  }
}

export async function addChatInternalNote(leadId: string, texto: string, autor?: string | null) {
  return prisma.chatInternalNote.create({ data: { leadId, texto, autor: autor?.trim() || null } })
}

const LIMITE_PREVIA_LISTA = 160

type EventoMensagem = {
  id: string
  tipo: string
  detalhes: string | null
  data: Date | string
  campanha: { nome: string } | null
}

type UltimaMensagemRow = {
  id: string
  leadId: string
  tipo: string
  detalhes: string | null
  data: Date | string
  campanhaNome: string | null
}

/**
 * Última mensagem de cada lead em uma única consulta (DISTINCT ON usa o índice
 * `leadId, data`). Antes, o painel baixava as 1000 mensagens mais recentes de
 * todos os leads, junto com os dados completos do lead repetidos em cada uma,
 * e ainda deixava de fora quem tinha conversa antiga.
 */
async function ultimasMensagensPorLead(): Promise<Map<string, ChatMessage>> {
  let linhas: UltimaMensagemRow[]
  try {
    linhas = await prisma.$queryRaw<UltimaMensagemRow[]>`
      SELECT DISTINCT ON (e."leadId")
        e."id", e."leadId", e."tipo"::text AS "tipo",
        LEFT(e."detalhes", 600) AS "detalhes", e."data", c."nome" AS "campanhaNome"
      FROM "TimelineEvent" e
      LEFT JOIN "Campaign" c ON c."id" = e."campanhaId"
      WHERE e."tipo"::text IN ('mensagem_enviada', 'resposta')
        AND EXISTS (SELECT 1 FROM "Lead" lw WHERE lw."id" = e."leadId" AND lw."workspaceId" = ${await workspaceAtualId()})
      ORDER BY e."leadId", e."data" DESC
    `
  } catch {
    // Plano B: o caminho antigo, só que sem repetir os dados do lead.
    const eventos = await prisma.timelineEvent.findMany({
      where: { tipo: { in: [...TIPOS_DE_MENSAGEM] } },
      select: { id: true, leadId: true, tipo: true, detalhes: true, data: true, campanha: { select: { nome: true } } },
      orderBy: { data: "desc" },
      take: LIMITE_EVENTOS_RECENTES,
    })
    linhas = eventos.map((e) => ({ ...e, campanhaNome: e.campanha?.nome ?? null }))
  }

  const mapa = new Map<string, ChatMessage>()
  for (const linha of linhas) {
    if (mapa.has(linha.leadId)) continue
    const mensagem = mapearMensagem({
      id: linha.id,
      tipo: linha.tipo,
      detalhes: linha.detalhes,
      data: linha.data,
      campanha: linha.campanhaNome ? { nome: linha.campanhaNome } : null,
    })
    // A lista só mostra uma prévia: não precisa trafegar a mensagem inteira.
    if (mensagem.texto.length > LIMITE_PREVIA_LISTA) {
      mensagem.texto = `${mensagem.texto.slice(0, LIMITE_PREVIA_LISTA)}…`
    }
    mapa.set(linha.leadId, mensagem)
  }
  return mapa
}

/** Histórico completo de um lead (mensagens + notas internas), em paralelo. */
export async function getChatMessages(leadId: string): Promise<ChatMessage[]> {
  const [eventos, notas] = await Promise.all([
    prisma.timelineEvent.findMany({
      where: { leadId, tipo: { in: [...TIPOS_DE_MENSAGEM] } },
      select: {
        id: true,
        tipo: true,
        detalhes: true,
        data: true,
        campanha: { select: { nome: true } },
      },
      orderBy: { data: "desc" },
      take: LIMITE_MENSAGENS_CONVERSA,
    }),
    prisma.chatInternalNote.findMany({
      where: { leadId },
      select: { id: true, texto: true, data: true, autor: true },
      orderBy: { data: "desc" },
      take: LIMITE_MENSAGENS_CONVERSA,
    }),
  ])

  return [...eventos.map(mapearMensagem), ...notas.map(mapearNota)].sort((a, b) => a.data.localeCompare(b.data))
}

export async function getChatInbox(
  conversaId?: string | null,
  opcoes: { semMensagens?: boolean } = {},
): Promise<ChatInboxSnapshot> {
  // Com a conversa já conhecida, o histórico é buscado junto com a lista
  // (antes era uma consulta depois da outra).
  const buscarJunto = conversaId && !opcoes.semMensagens ? conversaId : null

  const [leads, ultimas, mensagensAdiantadas, atendimentos, bots, followUps] = await Promise.all([
    prisma.lead.findMany({
      select: {
        id: true,
        nome: true,
        telefone: true,
        produto: true,
        marca: true,
        persona: true,
        regiao: true,
        negocio: true,
        atividade: true,
        status: true,
        atualizadoEm: true,
        campanha: { select: { nome: true } },
        campanhas: { select: { campanha: { select: { nome: true } } } },
      },
      orderBy: { atualizadoEm: "desc" },
    }),
    ultimasMensagensPorLead(),
    buscarJunto ? getChatMessages(buscarJunto) : Promise.resolve(null),
    // Só consulta o CRM quando o plugin está ativo; uma falha aqui nunca derruba o chat.
    getCrmPluginAtivo()
      .then((ativo) => (ativo ? listAtendimentosPorLead() : null))
      .catch(() => null),
    getCrmPluginAtivo()
      .then((ativo) => (ativo ? listBotsPorLead() : null))
      .catch(() => null),
    getCrmPluginAtivo()
      .then((ativo) => (ativo ? listarResumoFollowUpPorLead() : null))
      .catch(() => null),
  ])

  const conversas: ChatConversation[] = leads.map((lead) => {
    const ultimaMensagem = ultimas.get(lead.id) ?? null
    return {
      id: lead.id,
      nome: lead.nome,
      telefone: lead.telefone,
      produto: lead.produto,
      marca: lead.marca,
      persona: lead.persona,
      regiao: lead.regiao,
      negocio: lead.negocio,
      atividade: lead.atividade,
      status: lead.status,
      campanhasNomes: nomesDasCampanhas(lead.campanha, lead.campanhas),
      atualizadoEm: ultimaMensagem ? ultimaMensagem.data : lead.atualizadoEm.toISOString(),
      ultimaMensagem,
      atendimento: atendimentos?.get(lead.id) ?? null,
      bot: bots?.get(lead.id) ?? null,
      followUp: followUps?.get(lead.id) ?? null,
    }
  })
  conversas.sort((a, b) => new Date(b.atualizadoEm).getTime() - new Date(a.atualizadoEm).getTime())

  if (opcoes.semMensagens) {
    return { conversas, mensagens: [], conversaSelecionadaId: null }
  }

  const selecionada = conversas.find((conversa) => conversa.id === conversaId) ?? conversas[0] ?? null
  const mensagens = !selecionada
    ? []
    : mensagensAdiantadas && selecionada.id === buscarJunto
      ? mensagensAdiantadas
      : await getChatMessages(selecionada.id)

  return { conversas, mensagens, conversaSelecionadaId: selecionada?.id ?? null }
}

function nomesDasCampanhas(
  campanha: { nome: string } | null,
  campanhas: Array<{ campanha: { nome: string } }>,
): string[] {
  return [...new Set([campanha?.nome, ...campanhas.map((vinculo) => vinculo.campanha.nome)].filter((nome): nome is string => Boolean(nome)))]
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

export interface ChatExportItem {
  lead: {
    id: string
    nome: string
    telefone: string
    status: string
    produto: string
    marca: string
    persona: string
    regiao: string
    negocio: string | null
    atividade: string | null
    campanhas: string[]
  }
  mensagens: ChatMessage[]
}

const LIMITE_LEADS_EXPORTACAO = 2000

/**
 * Histórico COMPLETO (sem o corte de 250 da tela) de um ou mais leads, com
 * mensagens e notas internas, em consultas em lote. `leadIds` vazio/nulo =
 * todos os leads.
 */
export async function getChatsForExport(leadIds?: string[] | null): Promise<ChatExportItem[]> {
  const filtroLead = leadIds && leadIds.length ? { id: { in: leadIds.slice(0, LIMITE_LEADS_EXPORTACAO) } } : {}

  const leads = await prisma.lead.findMany({
    where: filtroLead,
    select: {
      id: true,
      nome: true,
      telefone: true,
      status: true,
      produto: true,
      marca: true,
      persona: true,
      regiao: true,
      negocio: true,
      atividade: true,
      campanha: { select: { nome: true } },
      campanhas: { select: { campanha: { select: { nome: true } } } },
    },
    orderBy: { atualizadoEm: "desc" },
    take: LIMITE_LEADS_EXPORTACAO,
  })
  if (leads.length === 0) return []

  const ids = leads.map((lead) => lead.id)
  const [eventos, notas] = await Promise.all([
    prisma.timelineEvent.findMany({
      where: { leadId: { in: ids }, tipo: { in: [...TIPOS_DE_MENSAGEM] } },
      select: { id: true, leadId: true, tipo: true, detalhes: true, data: true, campanha: { select: { nome: true } } },
      orderBy: { data: "asc" },
    }),
    prisma.chatInternalNote.findMany({
      where: { leadId: { in: ids } },
      select: { id: true, leadId: true, texto: true, data: true, autor: true },
      orderBy: { data: "asc" },
    }),
  ])

  const porLead = new Map<string, ChatMessage[]>()
  const adicionar = (leadId: string, mensagem: ChatMessage) => {
    const lista = porLead.get(leadId)
    if (lista) lista.push(mensagem)
    else porLead.set(leadId, [mensagem])
  }
  for (const evento of eventos) adicionar(evento.leadId, mapearMensagem(evento))
  for (const nota of notas) adicionar(nota.leadId, mapearNota(nota))

  return leads.map((lead) => ({
    lead: {
      id: lead.id,
      nome: lead.nome,
      telefone: lead.telefone,
      status: lead.status,
      produto: lead.produto,
      marca: lead.marca,
      persona: lead.persona,
      regiao: lead.regiao,
      negocio: lead.negocio,
      atividade: lead.atividade,
      campanhas: nomesDasCampanhas(lead.campanha, lead.campanhas),
    },
    mensagens: (porLead.get(lead.id) ?? []).sort((a, b) => a.data.localeCompare(b.data)),
  }))
}
