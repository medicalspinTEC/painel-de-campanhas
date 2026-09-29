import { prisma } from "@/lib/prisma"
import type { EventType } from "@/types"

const TIPOS_DE_MENSAGEM = ["mensagem_enviada", "resposta"] as const
const LIMITE_EVENTOS_RECENTES = 1000
const LIMITE_MENSAGENS_CONVERSA = 250

export interface ChatMessage {
  id: string
  lado: "lead" | "equipe"
  texto: string
  data: string
  campanhaNome: string | null
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
}

export interface ChatInboxSnapshot {
  conversas: ChatConversation[]
  mensagens: ChatMessage[]
  conversaSelecionadaId: string | null
}

function extrairTexto(detalhes: string | null, tipo: EventType): string {
  const prefixo = tipo === "resposta" ? "Resposta:" : "Mensagem:"
  const valor = (detalhes ?? "").trim()
  if (!valor.startsWith(prefixo)) return valor

  const conteudo = valor.slice(prefixo.length).trim()
  const entreAspas = conteudo.match(/^"([\s\S]*)"\.?(?:\r?\n|$)/)
  return entreAspas?.[1] ?? conteudo.replace(/^"|"$/g, "")
}

function mapearMensagem(evento: {
  id: string
  tipo: EventType
  detalhes: string | null
  data: Date
  campanha: { nome: string } | null
}): ChatMessage {
  return {
    id: evento.id,
    lado: evento.tipo === "resposta" ? "lead" : "equipe",
    texto: extrairTexto(evento.detalhes, evento.tipo),
    data: evento.data.toISOString(),
    campanhaNome: evento.campanha?.nome ?? null,
  }
}

export async function getChatInbox(conversaId?: string | null): Promise<ChatInboxSnapshot> {
  const [leads, eventosRecentes] = await Promise.all([
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
    prisma.timelineEvent.findMany({
      where: { tipo: { in: [...TIPOS_DE_MENSAGEM] } },
      select: {
        id: true,
        leadId: true,
        tipo: true,
        detalhes: true,
        data: true,
        campanha: { select: { nome: true } },
        lead: {
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
        },
      },
      orderBy: { data: "desc" },
      take: LIMITE_EVENTOS_RECENTES,
    }),
  ])

  const conversasPorId = new Map<string, ChatConversation>()
  for (const lead of leads) {
    conversasPorId.set(lead.id, {
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
      atualizadoEm: lead.atualizadoEm.toISOString(),
      ultimaMensagem: null,
    })
  }

  for (const evento of eventosRecentes) {
    const lead = evento.lead
    const conversa = conversasPorId.get(evento.leadId) ?? {
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
      atualizadoEm: lead.atualizadoEm.toISOString(),
      ultimaMensagem: null,
    }
    if (!conversa.ultimaMensagem) {
      conversa.ultimaMensagem = mapearMensagem(evento)
      conversa.atualizadoEm = evento.data.toISOString()
      conversasPorId.set(conversa.id, conversa)
    }
  }

  const conversas = [...conversasPorId.values()].sort(
    (a, b) => new Date(b.atualizadoEm).getTime() - new Date(a.atualizadoEm).getTime(),
  )
  const selecionada = conversas.find((conversa) => conversa.id === conversaId) ?? conversas[0] ?? null

  const eventosDaConversa = selecionada
    ? await prisma.timelineEvent.findMany({
        where: { leadId: selecionada.id, tipo: { in: [...TIPOS_DE_MENSAGEM] } },
        select: {
          id: true,
          tipo: true,
          detalhes: true,
          data: true,
          campanha: { select: { nome: true } },
        },
        orderBy: { data: "desc" },
        take: LIMITE_MENSAGENS_CONVERSA,
      })
    : []

  return {
    conversas,
    mensagens: eventosDaConversa.reverse().map(mapearMensagem),
    conversaSelecionadaId: selecionada?.id ?? null,
  }
}

function nomesDasCampanhas(
  campanha: { nome: string } | null,
  campanhas: Array<{ campanha: { nome: string } }>,
): string[] {
  return [...new Set([campanha?.nome, ...campanhas.map((vinculo) => vinculo.campanha.nome)].filter((nome): nome is string => Boolean(nome)))]
}
