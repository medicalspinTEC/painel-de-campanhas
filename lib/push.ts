/**
 * Notificações push (PWA): tipos, limites e validação. Arquivo puro (sem servidor/cliente):
 * é usado pela tela do Root, pelas actions e pelo serviço de envio (`services/push.ts`).
 */
import { isUserRole, type UserRole } from "@/lib/permissoes"

export const TITULO_MAX = 80
export const CORPO_MAX = 240
export const URL_MAX = 500
/** Tolerância mínima entre "agora" e o horário agendado. */
export const AGENDA_MIN_MS = 60_000
export const AGENDA_MAX_DIAS = 365
export const FUSO_PUSH = "America/Sao_Paulo"

export const STATUS_PUSH = ["rascunho", "agendada", "enviando", "enviada", "cancelada", "falha"] as const
export type StatusPush = (typeof STATUS_PUSH)[number]

export const NOME_STATUS_PUSH: Record<StatusPush, string> = {
  rascunho: "Rascunho",
  agendada: "Agendada",
  enviando: "Enviando…",
  enviada: "Enviada",
  cancelada: "Cancelada",
  falha: "Falhou",
}

/** Status em que a notificação ainda pode ser editada ou reenviada. */
export const STATUS_EDITAVEIS: readonly StatusPush[] = ["rascunho", "agendada", "cancelada", "falha"]

export type PublicoPush = "todos" | "papeis" | "usuarios"
export type ModoEnvioPush = "agora" | "agendar" | "rascunho"
export type PlataformaPush = "ios" | "android" | "desktop"

export interface PublicoEntrada {
  publico: PublicoPush
  papeis: UserRole[]
  usuarioIds: string[]
  somenteInstalados: boolean
}

export interface PushEntrada extends PublicoEntrada {
  titulo: string
  corpo: string
  url: string
  imagem: string
  urgente: boolean
  modo: ModoEnvioPush
  /** "AAAA-MM-DDTHH:mm" no horário de Brasília (valor de `datetime-local`). */
  agendadaPara: string
}

export interface PushItem {
  id: string
  titulo: string
  corpo: string
  url: string
  imagem: string | null
  urgente: boolean
  publico: PublicoPush
  papeis: UserRole[]
  usuarioIds: string[]
  somenteInstalados: boolean
  status: StatusPush
  agendadaPara: string | null
  enviadaEm: string | null
  totalAlvos: number
  enviados: number
  falhas: number
  removidos: number
  erro: string | null
  criadoPorNome: string | null
  criadoEm: string
}

export interface AparelhoPush {
  id: string
  userId: string
  usuarioNome: string
  usuarioNivel: UserRole
  plataforma: PlataformaPush
  instalado: boolean
  falhas: number
  criadoEm: string
  ultimoEnvioEm: string | null
}

export interface UsuarioPush {
  id: string
  nome: string
  username: string
  role: UserRole
  aparelhos: number
}

export interface ResumoPush {
  configurado: boolean
  /** Variáveis de ambiente que ainda faltam. */
  faltando: string[]
  aparelhos: number
  instalados: number
  usuarios: number
  porPlataforma: Record<PlataformaPush, number>
}

export const PUBLICOS_PUSH: { value: PublicoPush; label: string }[] = [
  { value: "todos", label: "Todos os usuários" },
  { value: "papeis", label: "Por nível de acesso" },
  { value: "usuarios", label: "Usuários específicos" },
]

export const MODOS_PUSH: { value: ModoEnvioPush; label: string }[] = [
  { value: "agora", label: "Enviar agora" },
  { value: "agendar", label: "Agendar" },
  { value: "rascunho", label: "Salvar como rascunho" },
]

/** Resumo legível do público (para a lista de envios). */
export function descreverPublico(n: Pick<PushItem, "publico" | "papeis" | "usuarioIds" | "somenteInstalados">): string {
  const base =
    n.publico === "todos"
      ? "Todos os usuários"
      : n.publico === "papeis"
        ? n.papeis.map((p) => (p === "root" ? "Root" : p === "admin" ? "Administradores" : "Usuários padrão")).join(", ") ||
          "Nenhum nível"
        : `${n.usuarioIds.length} ${n.usuarioIds.length === 1 ? "usuário" : "usuários"}`
  return `${base}${n.somenteInstalados ? " · só app instalado" : ""}`
}

const REGEX_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/** Destino do toque: caminho do painel (começa com uma só "/") ou endereço https. */
export function validarDestino(valor: string): { ok: true; url: string } | { ok: false; erro: string } {
  const url = valor.trim() || "/"
  if (url.length > URL_MAX) return { ok: false, erro: `O link pode ter no máximo ${URL_MAX} caracteres.` }
  if (url.startsWith("/") && !url.startsWith("//") && !/\s/.test(url)) return { ok: true, url }
  try {
    const parsed = new URL(url)
    if (parsed.protocol === "https:") return { ok: true, url: parsed.toString() }
  } catch {
    // cai no erro abaixo
  }
  return { ok: false, erro: "O link deve ser um caminho do painel (ex.: /chat) ou um endereço https." }
}

export type EntradaValidada = {
  titulo: string
  corpo: string
  url: string
  imagem: string | null
  urgente: boolean
} & PublicoEntrada & { modo: ModoEnvioPush; agendadaPara: string | null }

/** Valida e normaliza o formulário. A data agendada continua como texto local (o serviço a converte). */
export function validarEntradaPush(entrada: Partial<PushEntrada>): { ok: true; dados: EntradaValidada } | { ok: false; erro: string } {
  const titulo = String(entrada.titulo ?? "").trim()
  const corpo = String(entrada.corpo ?? "").trim()
  if (!titulo) return { ok: false, erro: "Informe o título." }
  if (titulo.length > TITULO_MAX) return { ok: false, erro: `O título pode ter no máximo ${TITULO_MAX} caracteres.` }
  if (!corpo) return { ok: false, erro: "Informe a mensagem." }
  if (corpo.length > CORPO_MAX) return { ok: false, erro: `A mensagem pode ter no máximo ${CORPO_MAX} caracteres.` }

  const destino = validarDestino(String(entrada.url ?? "/"))
  if (!destino.ok) return destino

  const imagemTexto = String(entrada.imagem ?? "").trim()
  let imagem: string | null = null
  if (imagemTexto) {
    try {
      const parsed = new URL(imagemTexto)
      if (parsed.protocol !== "https:" || imagemTexto.length > URL_MAX) throw new Error()
      imagem = parsed.toString()
    } catch {
      return { ok: false, erro: "A imagem deve ser um endereço https válido." }
    }
  }

  const publico: PublicoPush =
    entrada.publico === "papeis" || entrada.publico === "usuarios" ? entrada.publico : "todos"
  const papeis = [...new Set((entrada.papeis ?? []).filter(isUserRole))]
  const usuarioIds = [...new Set((entrada.usuarioIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0))]
  if (publico === "papeis" && papeis.length === 0) return { ok: false, erro: "Escolha ao menos um nível de acesso." }
  if (publico === "usuarios" && usuarioIds.length === 0) return { ok: false, erro: "Escolha ao menos um usuário." }

  const modo: ModoEnvioPush = entrada.modo === "agendar" || entrada.modo === "rascunho" ? entrada.modo : "agora"
  let agendadaPara: string | null = null
  if (modo === "agendar") {
    const texto = String(entrada.agendadaPara ?? "").trim()
    if (!REGEX_LOCAL.test(texto)) return { ok: false, erro: "Informe a data e a hora do envio." }
    agendadaPara = texto
  }

  return {
    ok: true,
    dados: {
      titulo,
      corpo,
      url: destino.url,
      imagem,
      urgente: entrada.urgente === true,
      publico,
      papeis: publico === "papeis" ? papeis : [],
      usuarioIds: publico === "usuarios" ? usuarioIds : [],
      somenteInstalados: entrada.somenteInstalados !== false,
      modo,
      agendadaPara,
    },
  }
}

/** Serviços de push aceitos (evita que o servidor poste para um endereço qualquer). */
const HOSTS_PUSH = [".googleapis.com", ".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"]

export function endpointPushValido(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false
  try {
    const url = new URL(endpoint)
    if (url.protocol !== "https:") return false
    return HOSTS_PUSH.some((sufixo) => url.hostname === sufixo.slice(1) || url.hostname.endsWith(sufixo))
  } catch {
    return false
  }
}

export function plataformaDoUserAgent(ua: string | null | undefined): PlataformaPush {
  const texto = ua ?? ""
  if (/iPhone|iPad|iPod/i.test(texto)) return "ios"
  if (/Android/i.test(texto)) return "android"
  return "desktop"
}

export const NOME_PLATAFORMA: Record<PlataformaPush, string> = {
  ios: "iPhone/iPad",
  android: "Android",
  desktop: "Computador",
}

/** Atalhos de destino na tela do Root (o campo também aceita outro endereço). */
export const DESTINOS_PUSH: { value: string; label: string }[] = [
  { value: "/", label: "Abrir o painel" },
  { value: "/dashboard", label: "Dashboard" },
  { value: "/chat", label: "Chat" },
  { value: "/leads", label: "Leads" },
  { value: "/campanhas", label: "Campanhas" },
  { value: "/eventos", label: "Eventos" },
]
