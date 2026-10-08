"use server"

import { ANEXO_INTERNO_TAMANHO_MAXIMO } from "@/lib/interno-storage"
import { assertSecao } from "@/lib/session"
import { recordAppLog } from "@/services/app-logs"
import {
  abrirConversaDireta,
  adicionarMembrosGrupoInterno,
  ChatInternoError,
  criarGrupoInterno,
  enviarMensagemInterna,
  excluirGrupoInterno,
  getInternoSnapshot,
  listarMensagensInternas as listarMensagensInterna,
  marcarConversaLida,
  removerMembroGrupoInterno,
  renomearGrupoInterno,
  sairDoGrupoInterno,
} from "@/services/chat-interno"

/**
 * Chat interno (equipe). Mesma permissão do Chat: seção "chat" (e plugin Chat ativo).
 * O usuário vem sempre da sessão — nunca de parâmetro — para ninguém ler/escrever como outra pessoa.
 */

async function executar<T extends object>(acao: () => Promise<T>, falha: string, contexto: string) {
  try {
    return { ok: true as const, ...(await acao()) }
  } catch (error) {
    if (error instanceof ChatInternoError) return { ok: false as const, message: error.message }
    await recordAppLog({ origem: "chat", mensagem: `${contexto}.`, detalhes: error })
    return { ok: false as const, message: falha }
  }
}

/** Lista de conversas (+ histórico da conversa aberta, que passa a contar como lida). */
export async function refreshChatInternoAction(conversaId?: string | null, semMensagens = false) {
  const usuario = await assertSecao("chat")
  return getInternoSnapshot(usuario.id, conversaId, { semMensagens })
}

/**
 * Histórico paginado: sem `antes`, as mensagens mais recentes (e a conversa passa a contar como lida);
 * com `antes`, a página anterior à mensagem mais antiga já carregada.
 */
export async function loadChatInternoMensagensAction(conversaId: string, antes?: string | null) {
  const usuario = await assertSecao("chat")
  return executar(
    async () => {
      const [pagina] = await Promise.all([
        listarMensagensInterna(usuario.id, conversaId, { antes }),
        antes ? Promise.resolve() : marcarConversaLida(usuario.id, conversaId),
      ])
      return pagina
    },
    "Não foi possível carregar a conversa.",
    `Falha ao carregar a conversa interna id=${conversaId}`,
  )
}

export async function abrirConversaInternaAction(outroUsuarioId: string) {
  const usuario = await assertSecao("chat")
  return executar(
    async () => ({ conversaId: await abrirConversaDireta(usuario.id, outroUsuarioId) }),
    "Não foi possível abrir a conversa.",
    "Falha ao abrir conversa interna",
  )
}

export async function criarGrupoInternoAction(nome: string, membrosIds: string[]) {
  const usuario = await assertSecao("chat")
  return executar(
    async () => ({ conversaId: await criarGrupoInterno(usuario.id, nome, Array.isArray(membrosIds) ? membrosIds.map(String) : []) }),
    "Não foi possível criar o grupo.",
    "Falha ao criar grupo interno",
  )
}

export async function sairDoGrupoInternoAction(conversaId: string) {
  const usuario = await assertSecao("chat")
  return executar(
    async () => {
      await sairDoGrupoInterno(usuario.id, conversaId)
      return {}
    },
    "Não foi possível sair do grupo.",
    `Falha ao sair do grupo interno id=${conversaId}`,
  )
}

export async function renomearGrupoInternoAction(conversaId: string, nome: string) {
  const usuario = await assertSecao("chat")
  return executar(
    async () => {
      await renomearGrupoInterno(usuario.id, conversaId, String(nome ?? ""))
      return {}
    },
    "Não foi possível renomear o grupo.",
    `Falha ao renomear grupo interno id=${conversaId}`,
  )
}

export async function adicionarMembrosGrupoInternoAction(conversaId: string, membrosIds: string[]) {
  const usuario = await assertSecao("chat")
  return executar(
    async () => {
      await adicionarMembrosGrupoInterno(usuario.id, conversaId, Array.isArray(membrosIds) ? membrosIds.map(String) : [])
      return {}
    },
    "Não foi possível adicionar as pessoas.",
    `Falha ao adicionar membros ao grupo interno id=${conversaId}`,
  )
}

export async function removerMembroGrupoInternoAction(conversaId: string, membroId: string) {
  const usuario = await assertSecao("chat")
  return executar(
    async () => {
      await removerMembroGrupoInterno(usuario.id, conversaId, String(membroId ?? ""))
      return {}
    },
    "Não foi possível remover a pessoa do grupo.",
    `Falha ao remover membro do grupo interno id=${conversaId}`,
  )
}

export async function excluirGrupoInternoAction(conversaId: string) {
  const usuario = await assertSecao("chat")
  return executar(
    async () => {
      await excluirGrupoInterno(usuario.id, conversaId)
      return {}
    },
    "Não foi possível excluir o grupo.",
    `Falha ao excluir grupo interno id=${conversaId}`,
  )
}

/**
 * Envia texto e/ou um arquivo. FormData: `texto` (ou legenda) e `arquivo` (opcional).
 * O arquivo NÃO vai para o banco: fica numa pasta do servidor até os outros participantes baixarem.
 */
export async function enviarMensagemInternaAction(conversaId: string, formData: FormData) {
  const usuario = await assertSecao("chat")

  const textoBruto = formData.get("texto")
  const texto = typeof textoBruto === "string" ? textoBruto : ""
  const arquivo = formData.get("arquivo")
  const temArquivo = arquivo instanceof File && arquivo.size > 0
  if (temArquivo && arquivo.size > ANEXO_INTERNO_TAMANHO_MAXIMO) {
    return { ok: false as const, message: `O arquivo é muito grande (máximo de ${Math.round(ANEXO_INTERNO_TAMANHO_MAXIMO / 1024 / 1024)} MB).` }
  }

  return executar(
    async () => ({
      mensagem: await enviarMensagemInterna(
        usuario.id,
        conversaId,
        texto,
        temArquivo ? { dados: Buffer.from(await arquivo.arrayBuffer()), nome: arquivo.name, mime: arquivo.type } : null,
      ),
    }),
    "Não foi possível enviar a mensagem.",
    `Falha ao enviar mensagem interna na conversa id=${conversaId}`,
  )
}
