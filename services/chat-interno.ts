import { podeAcessar } from "@/lib/permissoes"
import { prisma } from "@/lib/prisma"
import {
  ANEXO_INTERNO_TAMANHO_MAXIMO,
  anexoInternoExiste,
  nomeDoAnexo,
  removerAnexoInterno,
  salvarAnexoInterno,
  tipoDeAnexo,
} from "@/lib/interno-storage"
import { idDeArquivoValido, mimeLimpo } from "@/lib/arquivo-storage"
import { toUsuario } from "@/services/users"

/**
 * Chat interno (equipe): conversa entre os usuários do painel, dentro da plataforma (não passa
 * pelo WhatsApp). Parte do plugin Chat — a permissão é a da seção "chat".
 *
 *  - Texto: guardado no banco (`InternoMensagem`).
 *  - Imagens/arquivos: o conteúdo NÃO vai para o banco. Fica numa pasta do servidor e é apagado
 *    quando todos os outros participantes baixam (ou ao fim do prazo de retenção). O banco guarda só
 *    os metadados. Ver `lib/interno-storage.ts`.
 *
 * O isolamento por instância é feito por `lib/prisma.ts` (InternoConversa tem `workspaceId`).
 */

export const LIMITE_TEXTO_INTERNO = 4096
/** Mensagens por página do histórico (as mais recentes primeiro; as anteriores carregam sob demanda). */
export const PAGINA_MENSAGENS = 50
const LIMITE_NOME_GRUPO = 60
const MAX_PARTICIPANTES_GRUPO = 50

export class ChatInternoError extends Error {}

export interface InternoContato {
  id: string
  nome: string
  username: string
}

export interface InternoAnexo {
  id: string
  tipo: "imagem" | "documento" | "video"
  mime: string
  tamanho: number
  nome: string
  /** Arquivo ainda no servidor (ninguém — ou nem todos — baixou, e não expirou). */
  disponivel: boolean
  /** Eu (não-autor) já baixei: o botão some para mim. */
  baixadoPorMim: boolean
}

export interface InternoMensagemDto {
  id: string
  autorId: string
  autorNome: string
  texto: string
  data: string
  anexo: InternoAnexo | null
}

export interface InternoConversaDto {
  id: string
  tipo: "direta" | "grupo"
  /** Nome exibido: o do grupo, ou o do outro participante na conversa direta. */
  nome: string
  participantes: InternoContato[]
  ultimaMensagem: { texto: string; autorNome: string; data: string; temAnexo: boolean; minha: boolean } | null
  ultimaAtividade: string
  naoLidas: number
}

export interface InternoSnapshot {
  conversas: InternoConversaDto[]
  contatos: InternoContato[]
  conversaSelecionadaId: string | null
  mensagens: InternoMensagemDto[]
  /** Há mensagens mais antigas que as retornadas. */
  temMais: boolean
}

// ---------------------------------------------------------------------------
// Contatos e conversas
// ---------------------------------------------------------------------------

/** Usuários ativos da instância que têm acesso ao Chat (menos o próprio). */
export async function listarContatosInternos(userId: string): Promise<InternoContato[]> {
  const linhas = await prisma.user.findMany({ where: { ativo: true, id: { not: userId } }, orderBy: { nome: "asc" } })
  return linhas
    .filter((linha) => podeAcessar(toUsuario(linha), "chat"))
    .map((linha) => ({ id: linha.id, nome: linha.nome, username: linha.username }))
}

async function participanteDe(userId: string, conversaId: string) {
  return prisma.internoParticipante.findFirst({ where: { conversaId, userId } })
}

async function exigirParticipante(userId: string, conversaId: string): Promise<void> {
  if (!conversaId || !(await participanteDe(userId, conversaId))) {
    throw new ChatInternoError("Conversa não encontrada.")
  }
}

function chaveDireta(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

/** Abre (ou cria) a conversa direta com outro usuário. */
export async function abrirConversaDireta(userId: string, outroId: string): Promise<string> {
  if (!outroId || outroId === userId) throw new ChatInternoError("Escolha outra pessoa para conversar.")
  const contatos = await listarContatosInternos(userId)
  if (!contatos.some((c) => c.id === outroId)) throw new ChatInternoError("Esta pessoa não está disponível para conversa interna.")

  const chave = chaveDireta(userId, outroId)
  const existente = await prisma.internoConversa.findFirst({ where: { chaveDireta: chave }, select: { id: true } })
  if (existente) return existente.id

  try {
    const criada = await prisma.internoConversa.create({
      data: {
        tipo: "direta",
        chaveDireta: chave,
        criadoPorId: userId,
        participantes: { create: [{ userId }, { userId: outroId }] },
      },
      select: { id: true },
    })
    return criada.id
  } catch {
    // Corrida: as duas pessoas abriram ao mesmo tempo — vale a que ganhou.
    const ganhadora = await prisma.internoConversa.findFirst({ where: { chaveDireta: chave }, select: { id: true } })
    if (ganhadora) return ganhadora.id
    throw new ChatInternoError("Não foi possível abrir a conversa.")
  }
}

/** Cria um grupo com o criador e as pessoas escolhidas. */
export async function criarGrupoInterno(userId: string, nome: string, membrosIds: string[]): Promise<string> {
  const nomeLimpo = nome.trim().slice(0, LIMITE_NOME_GRUPO)
  if (!nomeLimpo) throw new ChatInternoError("Dê um nome ao grupo.")
  const ids = [...new Set(membrosIds.filter((id) => id && id !== userId))]
  if (ids.length < 2) throw new ChatInternoError("Um grupo precisa de pelo menos 2 pessoas além de você.")
  if (ids.length + 1 > MAX_PARTICIPANTES_GRUPO) throw new ChatInternoError(`Um grupo aceita até ${MAX_PARTICIPANTES_GRUPO} pessoas.`)

  const contatos = new Set((await listarContatosInternos(userId)).map((c) => c.id))
  if (ids.some((id) => !contatos.has(id))) throw new ChatInternoError("Alguma das pessoas escolhidas não está disponível.")

  const criada = await prisma.internoConversa.create({
    data: {
      tipo: "grupo",
      nome: nomeLimpo,
      criadoPorId: userId,
      participantes: { create: [userId, ...ids].map((id) => ({ userId: id })) },
    },
    select: { id: true },
  })
  return criada.id
}

/** Sai de um grupo (conversas diretas não têm saída). Sem participantes, o grupo é apagado. */
export async function sairDoGrupoInterno(userId: string, conversaId: string): Promise<void> {
  const conversa = await prisma.internoConversa.findFirst({ where: { id: conversaId }, select: { tipo: true } })
  if (!conversa || !(await participanteDe(userId, conversaId))) throw new ChatInternoError("Conversa não encontrada.")
  if (conversa.tipo !== "grupo") throw new ChatInternoError("Só é possível sair de grupos.")
  await prisma.internoParticipante.deleteMany({ where: { conversaId, userId } })
  const restantes = await prisma.internoParticipante.count({ where: { conversaId } })
  if (restantes === 0) await excluirConversaSemParticipantes(conversaId)
}

async function excluirConversaSemParticipantes(conversaId: string): Promise<void> {
  const anexos = await prisma.internoMensagem.findMany({ where: { conversaId, anexoId: { not: null } }, select: { anexoId: true } })
  for (const { anexoId } of anexos) if (anexoId) await removerAnexoInterno(anexoId)
  await prisma.internoConversa.deleteMany({ where: { id: conversaId } })
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

function previewDeAnexo(tipo: string | null): string {
  if (tipo === "imagem") return "📷 Imagem"
  if (tipo === "video") return "🎬 Vídeo"
  return "📎 Arquivo"
}

export async function listarConversasInternas(userId: string): Promise<InternoConversaDto[]> {
  const participacoes = await prisma.internoParticipante.findMany({
    where: { userId },
    include: {
      conversa: {
        include: {
          participantes: { include: { user: { select: { id: true, nome: true, username: true } } } },
        },
      },
    },
  })

  const conversas = await Promise.all(
    participacoes.map(async (participacao) => {
      const conversa = participacao.conversa
      const [ultima, naoLidas] = await Promise.all([
        prisma.internoMensagem.findFirst({
          where: { conversaId: conversa.id },
          orderBy: { criadoEm: "desc" },
          include: { autor: { select: { nome: true } } },
        }),
        prisma.internoMensagem.count({
          where: { conversaId: conversa.id, autorId: { not: userId }, criadoEm: { gt: participacao.ultimaLeituraEm } },
        }),
      ])

      const participantes: InternoContato[] = conversa.participantes.map((p) => ({
        id: p.user.id,
        nome: p.user.nome,
        username: p.user.username,
      }))
      const outro = participantes.find((p) => p.id !== userId)
      const tipo = conversa.tipo === "grupo" ? "grupo" : "direta"

      return {
        id: conversa.id,
        tipo,
        nome: tipo === "grupo" ? (conversa.nome ?? "Grupo") : (outro?.nome ?? "Conversa"),
        participantes,
        ultimaMensagem: ultima
          ? {
              texto: ultima.texto.trim() || previewDeAnexo(ultima.anexoTipo),
              autorNome: ultima.autor.nome,
              data: ultima.criadoEm.toISOString(),
              temAnexo: Boolean(ultima.anexoId),
              minha: ultima.autorId === userId,
            }
          : null,
        ultimaAtividade: (ultima?.criadoEm ?? conversa.criadoEm).toISOString(),
        naoLidas,
      } satisfies InternoConversaDto
    }),
  )

  return conversas.sort((a, b) => b.ultimaAtividade.localeCompare(a.ultimaAtividade))
}

type LinhaMensagem = {
  id: string
  autorId: string
  texto: string
  criadoEm: Date
  anexoId: string | null
  anexoTipo: string | null
  anexoMime: string | null
  anexoTamanho: number | null
  anexoNome: string | null
  baixadoPor: string[]
}

function paraDto(linha: LinhaMensagem, userId: string, nomes: Map<string, string>): InternoMensagemDto {
  const anexo: InternoAnexo | null =
    linha.anexoId && linha.anexoTipo
      ? {
          id: linha.anexoId,
          tipo: linha.anexoTipo as InternoAnexo["tipo"],
          mime: linha.anexoMime ?? "application/octet-stream",
          tamanho: linha.anexoTamanho ?? 0,
          nome: linha.anexoNome ?? "arquivo",
          disponivel: anexoInternoExiste(linha.anexoId),
          baixadoPorMim: linha.autorId !== userId && linha.baixadoPor.includes(userId),
        }
      : null
  return {
    id: linha.id,
    autorId: linha.autorId,
    autorNome: nomes.get(linha.autorId) ?? "Ex-participante",
    texto: linha.texto,
    data: linha.criadoEm.toISOString(),
    anexo,
  }
}

/**
 * Uma página do histórico (da mais antiga para a mais nova). Sem `antes`, devolve as mais recentes;
 * com `antes` (data ISO da mensagem mais antiga já carregada), devolve as anteriores a ela.
 * A checagem de participação e a leitura das mensagens rodam em paralelo (uma ida ao banco só).
 */
export async function listarMensagensInternas(
  userId: string,
  conversaId: string,
  opcoes: { antes?: string | null } = {},
): Promise<{ mensagens: InternoMensagemDto[]; temMais: boolean }> {
  const antes = opcoes.antes ? new Date(opcoes.antes) : null
  const [participantes, linhas] = await Promise.all([
    prisma.internoParticipante.findMany({ where: { conversaId }, select: { user: { select: { id: true, nome: true } } } }),
    prisma.internoMensagem.findMany({
      where: { conversaId, ...(antes && !Number.isNaN(antes.getTime()) ? { criadoEm: { lt: antes } } : {}) },
      orderBy: { criadoEm: "desc" },
      take: PAGINA_MENSAGENS + 1,
    }),
  ])
  if (!participantes.some((p) => p.user.id === userId)) throw new ChatInternoError("Conversa não encontrada.")

  const nomes = new Map<string, string>(participantes.map((p) => [p.user.id, p.user.nome] as [string, string]))
  const temMais = linhas.length > PAGINA_MENSAGENS
  const pagina = linhas.slice(0, PAGINA_MENSAGENS).reverse()
  return { mensagens: pagina.map((linha) => paraDto(linha, userId, nomes)), temMais }
}

/** Marca a conversa como lida (tudo até agora). */
export async function marcarConversaLida(userId: string, conversaId: string): Promise<void> {
  await prisma.internoParticipante.updateMany({ where: { conversaId, userId }, data: { ultimaLeituraEm: new Date() } })
}

export async function getInternoSnapshot(
  userId: string,
  conversaId?: string | null,
  opcoes: { semMensagens?: boolean } = {},
): Promise<InternoSnapshot> {
  const [conversas, contatos] = await Promise.all([listarConversasInternas(userId), listarContatosInternos(userId)])
  const selecionada = conversaId && conversas.some((c) => c.id === conversaId) ? conversaId : null
  let mensagens: InternoMensagemDto[] = []
  let temMais = false
  if (selecionada && !opcoes.semMensagens) {
    // Quem está com a conversa aberta lê o que chega: marca como lida junto com a leitura.
    const [pagina] = await Promise.all([listarMensagensInternas(userId, selecionada), marcarConversaLida(userId, selecionada)])
    mensagens = pagina.mensagens
    temMais = pagina.temMais
    const conversa = conversas.find((c) => c.id === selecionada)
    if (conversa) conversa.naoLidas = 0
  }
  return { conversas, contatos, conversaSelecionadaId: selecionada, mensagens, temMais }
}

/** Total de mensagens não lidas em todas as conversas (para o selo da aba). */
export async function contarNaoLidasInternas(userId: string): Promise<number> {
  const participacoes = await prisma.internoParticipante.findMany({
    where: { userId },
    select: { conversaId: true, ultimaLeituraEm: true },
  })
  const contagens = await Promise.all(
    participacoes.map((p) =>
      prisma.internoMensagem.count({ where: { conversaId: p.conversaId, autorId: { not: userId }, criadoEm: { gt: p.ultimaLeituraEm } } }),
    ),
  )
  return contagens.reduce((soma, n) => soma + n, 0)
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

export async function enviarMensagemInterna(
  userId: string,
  conversaId: string,
  texto: string,
  anexo?: { dados: Buffer; nome: string; mime: string } | null,
): Promise<InternoMensagemDto> {
  await exigirParticipante(userId, conversaId)

  const textoLimpo = texto.trim()
  if (textoLimpo.length > LIMITE_TEXTO_INTERNO) {
    throw new ChatInternoError(`A mensagem é muito longa (máximo de ${LIMITE_TEXTO_INTERNO} caracteres).`)
  }
  if (!textoLimpo && !anexo) throw new ChatInternoError("Escreva uma mensagem ou escolha um arquivo.")
  if (anexo && anexo.dados.length === 0) throw new ChatInternoError("O arquivo está vazio.")
  if (anexo && anexo.dados.length > ANEXO_INTERNO_TAMANHO_MAXIMO) {
    throw new ChatInternoError(`O arquivo é muito grande (máximo de ${Math.round(ANEXO_INTERNO_TAMANHO_MAXIMO / 1024 / 1024)} MB).`)
  }

  let anexoId: string | null = null
  const mime = anexo ? mimeLimpo(anexo.mime) : null
  if (anexo) anexoId = await salvarAnexoInterno(anexo.dados)

  try {
    const agora = new Date()
    const [linha, autor] = await Promise.all([
      prisma.internoMensagem.create({
        data: {
          conversaId,
          autorId: userId,
          texto: textoLimpo,
          criadoEm: agora,
          ...(anexo && anexoId && mime
            ? {
                anexoId,
                anexoTipo: tipoDeAnexo(mime),
                anexoMime: mime,
                anexoTamanho: anexo.dados.length,
                anexoNome: nomeDoAnexo(anexo.nome, mime),
              }
            : {}),
        },
      }),
      prisma.user.findFirst({ where: { id: userId }, select: { nome: true } }),
      prisma.internoConversa.updateMany({ where: { id: conversaId }, data: { ultimaMensagemEm: agora } }),
      // Quem escreve já leu tudo até aqui.
      prisma.internoParticipante.updateMany({ where: { conversaId, userId }, data: { ultimaLeituraEm: agora } }),
    ])
    return paraDto(linha, userId, new Map([[userId, autor?.nome ?? "Você"]]))
  } catch (error) {
    // Não deixa um arquivo órfão no servidor se a gravação falhou.
    if (anexoId) await removerAnexoInterno(anexoId)
    throw error
  }
}

// ---------------------------------------------------------------------------
// Download (o arquivo é apagado quando todos os outros participantes baixam)
// ---------------------------------------------------------------------------

export interface DownloadInterno {
  mensagemId: string
  anexoId: string
  meta: { mime: string; nome: string }
  /** Quem baixa é o autor: não conta para a exclusão. */
  ehAutor: boolean
  workspaceId: string
}

/** Confere que o usuário participa da conversa do anexo e devolve o necessário para servir o download. */
export async function prepararDownloadInterno(userId: string, anexoId: string): Promise<DownloadInterno | null> {
  if (!idDeArquivoValido(anexoId)) return null
  const mensagem = await prisma.internoMensagem.findFirst({
    where: { anexoId },
    select: { id: true, conversaId: true, autorId: true, anexoMime: true, anexoNome: true, conversa: { select: { workspaceId: true } } },
  })
  if (!mensagem) return null
  if (!(await participanteDe(userId, mensagem.conversaId))) return null
  return {
    mensagemId: mensagem.id,
    anexoId,
    meta: { mime: mensagem.anexoMime ?? "application/octet-stream", nome: mensagem.anexoNome ?? "arquivo" },
    ehAutor: mensagem.autorId === userId,
    workspaceId: mensagem.conversa.workspaceId,
  }
}

/**
 * Chamado quando o download terminou por inteiro. Registra quem baixou e, se todos os outros
 * participantes ativos já baixaram, apaga o arquivo do servidor.
 */
export async function concluirDownloadInterno(userId: string, download: DownloadInterno): Promise<{ apagado: boolean }> {
  if (download.ehAutor) return { apagado: false }

  const mensagem = await prisma.internoMensagem.findFirst({
    where: { id: download.mensagemId },
    select: { conversaId: true, autorId: true, baixadoPor: true },
  })
  if (!mensagem) return { apagado: false }

  const baixou = new Set(mensagem.baixadoPor)
  baixou.add(userId)
  await prisma.internoMensagem.updateMany({ where: { id: download.mensagemId }, data: { baixadoPor: [...baixou] } })

  const destinatarios = await prisma.internoParticipante.findMany({
    where: { conversaId: mensagem.conversaId, userId: { not: mensagem.autorId }, user: { ativo: true } },
    select: { userId: true },
  })
  const faltam = destinatarios.some((d) => !baixou.has(d.userId))
  if (destinatarios.length > 0 && !faltam) {
    await removerAnexoInterno(download.anexoId)
    return { apagado: true }
  }
  return { apagado: false }
}
