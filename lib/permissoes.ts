/**
 * Níveis de usuário, seções do painel e poderes de gestão.
 *
 * Este arquivo é puro (sem servidor/cliente): é usado pela sidebar, pelo
 * formulário de usuários e pelas checagens de acesso no servidor.
 *
 * Hierarquia: root > admin > padrao.
 *
 * - `root`: acesso total. Controla todos os níveis (admin e padrão) e decide o
 *   que cada admin pode acessar (seções) e controlar (poderes).
 * - `admin`: acessa só as seções que o root liberou e só faz o que o root
 *   permitiu (poderes). Gerencia apenas usuários padrão, e só consegue liberar
 *   para eles seções que ele mesmo acessa.
 * - `padrao`: só acessa as seções liberadas por quem o gerencia.
 */

export type UserRole = "root" | "admin" | "padrao"

export const NIVEIS: readonly { key: UserRole; label: string }[] = [
  { key: "root", label: "Root" },
  { key: "admin", label: "Administrador" },
  { key: "padrao", label: "Usuário padrão" },
]

const ORDEM_NIVEL: Record<UserRole, number> = { padrao: 1, admin: 2, root: 3 }

export function isUserRole(valor: unknown): valor is UserRole {
  return valor === "root" || valor === "admin" || valor === "padrao"
}

export function nomeDoNivel(role: UserRole): string {
  return NIVEIS.find((n) => n.key === role)?.label ?? role
}

/** Quanto maior, mais alto na hierarquia (root = 3, admin = 2, padrão = 1). */
export function ordemDoNivel(role: UserRole): number {
  return ORDEM_NIVEL[role]
}

// ---------------------------------------------------------------------------
// Seções
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Poderes do admin (o que o root permite que ele controle)
// ---------------------------------------------------------------------------

export const PODERES = [
  {
    key: "usuarios_criar",
    label: "Criar usuários",
    descricao: "Cadastra novos usuários padrão.",
    grupo: "Usuários",
  },
  {
    key: "usuarios_editar",
    label: "Editar usuários",
    descricao: "Altera nome, login, senha e ativa/desativa usuários padrão.",
    grupo: "Usuários",
  },
  {
    key: "usuarios_secoes",
    label: "Definir seções dos usuários",
    descricao: "Libera ou remove seções dos usuários padrão — só as que o próprio admin acessa.",
    grupo: "Usuários",
  },
  {
    key: "usuarios_excluir",
    label: "Excluir usuários",
    descricao: "Remove usuários padrão.",
    grupo: "Usuários",
  },
  {
    key: "crm_gerenciar",
    label: "Gerenciar o CRM",
    descricao: "Departamentos e atendentes (com o plugin CRM ativo).",
    grupo: "Plugins e sistema",
  },
  {
    key: "rotas_secretas",
    label: "Acessar as rotas secretas",
    descricao: "Explorador e testes das rotas de API.",
    grupo: "Plugins e sistema",
  },
] as const

export type PoderKey = (typeof PODERES)[number]["key"]

const CHAVES_PODER = new Set<string>(PODERES.map((p) => p.key))
const PODERES_USUARIOS = PODERES.filter((p) => p.key.startsWith("usuarios_")).map((p) => p.key)

export function isPoderKey(valor: unknown): valor is PoderKey {
  return typeof valor === "string" && CHAVES_PODER.has(valor)
}

/** Filtra uma lista qualquer mantendo só poderes válidos, sem repetição. */
export function normalizarPoderes(valor: unknown): PoderKey[] {
  if (!Array.isArray(valor)) return []
  return [...new Set(valor.filter(isPoderKey))]
}

// ---------------------------------------------------------------------------
// Regras de acesso
// ---------------------------------------------------------------------------

export type UsuarioAcesso = {
  role: UserRole
  secoes: readonly string[]
  poderes?: readonly string[]
}

/** Root acessa tudo; admin e padrão só as seções liberadas para eles. */
export function podeAcessar(usuario: UsuarioAcesso, secao: SecaoKey): boolean {
  if (usuario.role === "root") return true
  return usuario.secoes.includes(secao)
}

/** Root tem todos os poderes; admin só os que o root liberou; padrão nenhum. */
export function temPoder(usuario: { role: UserRole; poderes?: readonly string[] }, poder: PoderKey): boolean {
  if (usuario.role === "root") return true
  if (usuario.role === "admin") return usuario.poderes?.includes(poder) ?? false
  return false
}

/** Acessa a tela de Usuários: root, ou admin com ao menos um poder de usuários. */
export function podeGerenciarUsuarios(usuario: { role: UserRole; poderes?: readonly string[] }): boolean {
  if (usuario.role === "root") return true
  return PODERES_USUARIOS.some((poder) => temPoder(usuario, poder))
}

/** Níveis que o usuário pode criar, editar e excluir (nunca o próprio nível ou acima, exceto root). */
export function niveisGerenciaveis(usuario: { role: UserRole }): UserRole[] {
  if (usuario.role === "root") return ["root", "admin", "padrao"]
  if (usuario.role === "admin") return ["padrao"]
  return []
}

export function podeGerenciarNivel(usuario: { role: UserRole }, alvo: UserRole): boolean {
  return niveisGerenciaveis(usuario).includes(alvo)
}

/** Seções que o usuário pode liberar para outros: todas (root) ou as que ele próprio acessa (admin). */
export function secoesQuePodeConceder(usuario: { role: UserRole; secoes: readonly string[] }): SecaoKey[] {
  if (usuario.role === "root") return SECOES.map((s) => s.key)
  if (usuario.role === "admin") return normalizarSecoes([...usuario.secoes])
  return []
}

/** Primeira seção liberada, usada como destino quando a página pedida é negada. */
export function primeiraRotaPermitida(usuario: UsuarioAcesso): string | null {
  const secao = SECOES.find((s) => podeAcessar(usuario, s.key))
  return secao?.url ?? null
}
