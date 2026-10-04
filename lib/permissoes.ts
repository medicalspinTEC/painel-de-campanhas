/**
 * Níveis de usuário e seções do painel.
 *
 * Este arquivo é puro (sem servidor/cliente): é usado pela sidebar, pelo
 * formulário de usuários e pelas checagens de acesso no servidor.
 *
 * - `admin`: acesso total. Cria, edita e exclui usuários e define as seções
 *   que cada usuário padrão pode acessar.
 * - `padrao`: só acessa as seções liberadas por um admin.
 */

export type UserRole = "admin" | "padrao"

export const SECOES = [
  { key: "dashboard", label: "Dashboard", url: "/dashboard", grupo: "Gestão" },
  { key: "leads", label: "Leads", url: "/leads", grupo: "Gestão" },
  { key: "kanban", label: "Kanban", url: "/kanban", grupo: "Gestão" },
  { key: "chat", label: "Chat", url: "/chat", grupo: "Gestão" },
  { key: "assistente", label: "Assistente", url: "/assistente", grupo: "Gestão" },
  { key: "nocode", label: "No Code", url: "/nocode", grupo: "Gestão" },
  { key: "campanhas", label: "Campanhas", url: "/campanhas", grupo: "Gestão" },
  { key: "segmentacao", label: "Segmentação", url: "/segmentacao", grupo: "Gestão" },
  { key: "eventos", label: "Eventos", url: "/eventos", grupo: "Acompanhamento" },
  { key: "logs", label: "Logs", url: "/logs", grupo: "Acompanhamento" },
  { key: "relatorios", label: "Relatórios", url: "/relatorios", grupo: "Acompanhamento" },
  { key: "instancias", label: "Instâncias", url: "/instancias", grupo: "Sistema" },
  { key: "integracoes", label: "Integrações", url: "/integracoes", grupo: "Sistema" },
  { key: "configuracoes", label: "Configurações", url: "/configuracoes", grupo: "Sistema" },
] as const

export type SecaoKey = (typeof SECOES)[number]["key"]

const CHAVES = new Set<string>(SECOES.map((s) => s.key))

export function isSecaoKey(valor: unknown): valor is SecaoKey {
  return typeof valor === "string" && CHAVES.has(valor)
}

/** Filtra uma lista qualquer mantendo só chaves válidas, sem repetição. */
export function normalizarSecoes(valor: unknown): SecaoKey[] {
  if (!Array.isArray(valor)) return []
  return [...new Set(valor.filter(isSecaoKey))]
}

export type UsuarioAcesso = { role: UserRole; secoes: readonly string[] }

/** Admin acessa tudo; usuário padrão só as seções liberadas. */
export function podeAcessar(usuario: UsuarioAcesso, secao: SecaoKey): boolean {
  if (usuario.role === "admin") return true
  return usuario.secoes.includes(secao)
}

/** Primeira seção liberada, usada como destino quando a página pedida é negada. */
export function primeiraRotaPermitida(usuario: UsuarioAcesso): string | null {
  const secao = SECOES.find((s) => podeAcessar(usuario, s.key))
  return secao?.url ?? null
}
