/**
 * Catálogo dos blocos do plugin No Code. Compartilhado entre o editor (cliente)
 * e o motor de execução (servidor) — por isso não importa nada de React/Prisma.
 *
 * Os blocos são fixos (sem JavaScript livre): cada um faz uma coisa e é
 * configurado por campos. Valores de texto aceitam variáveis `{{caminho}}`.
 */

export type NodeType =
  | "webhook"
  | "extrair_telefone"
  | "condicao"
  | "buscar_lead"
  | "registrar_resposta"
  | "enviar_mensagem"
  | "aguardar"
  | "ignorar"

export type NodeConfig = Record<string, string | number | boolean>

export interface FlowNode {
  id: string
  type: NodeType
  name: string
  position: { x: number; y: number }
  config: NodeConfig
}

export interface FlowEdge {
  id: string
  source: string
  /** Saída do bloco de origem ("main", "true", "false"). */
  sourceHandle: string
  target: string
}

export type Categoria = "Gatilho" | "Lógica" | "Dados" | "Ação"

export interface NodeField {
  key: string
  label: string
  kind: "text" | "textarea" | "select" | "switch" | "number"
  placeholder?: string
  help?: string
  options?: { value: string; label: string }[]
}

export interface NodeDef {
  type: NodeType
  label: string
  descricao: string
  categoria: Categoria
  /** Nome do ícone lucide usado pelo editor. */
  icone: "Webhook" | "Phone" | "GitBranch" | "UserSearch" | "MessageSquareReply" | "Send" | "Timer" | "Ban"
  /** Classes de cor do ícone (Tailwind). */
  cor: string
  temEntrada: boolean
  saidas: { id: string; label: string }[]
  campos: NodeField[]
  padrao: NodeConfig
}

export const OPERADORES = [
  { value: "igual", label: "é igual a" },
  { value: "diferente", label: "é diferente de" },
  { value: "contem", label: "contém" },
  { value: "nao_contem", label: "não contém" },
  { value: "comeca_com", label: "começa com" },
  { value: "existe", label: "existe (preenchido)" },
  { value: "nao_existe", label: "não existe (vazio)" },
  { value: "verdadeiro", label: "é verdadeiro" },
  { value: "falso", label: "é falso" },
  { value: "maior", label: "é maior que" },
  { value: "menor", label: "é menor que" },
] as const

export const OPERADORES_SEM_VALOR = ["existe", "nao_existe", "verdadeiro", "falso"]

export const NODE_CATALOG: Record<NodeType, NodeDef> = {
  webhook: {
    type: "webhook",
    label: "Webhook (Evolution)",
    descricao: "Inicia o fluxo quando a Evolution API envia um evento para o app.",
    categoria: "Gatilho",
    icone: "Webhook",
    cor: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    temEntrada: false,
    saidas: [{ id: "main", label: "" }],
    campos: [
      {
        key: "evento",
        label: "Evento aceito",
        kind: "text",
        placeholder: "messages.upsert",
        help: "Eventos diferentes são ignorados sem gerar execução. Deixe vazio para aceitar todos.",
      },
    ],
    padrao: { evento: "messages.upsert", token: "" },
  },
  extrair_telefone: {
    type: "extrair_telefone",
    label: "Extrair telefone",
    descricao: "Pega o número do remetente (remoteJid) e, se quiser, adiciona o 9º dígito.",
    categoria: "Dados",
    icone: "Phone",
    cor: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    temEntrada: true,
    saidas: [{ id: "main", label: "" }],
    campos: [
      {
        key: "campo",
        label: "Campo de origem",
        kind: "text",
        placeholder: "webhook.data.key.remoteJid",
        help: "Caminho do número no evento recebido. Resultado: variável {{telefone}}.",
      },
      {
        key: "adicionar9",
        label: "Adicionar o 9 após o DDD (Brasil)",
        kind: "switch",
        help: "Para números com 12 dígitos começando em 55.",
      },
    ],
    padrao: { campo: "webhook.data.key.remoteJid", adicionar9: true },
  },
  condicao: {
    type: "condicao",
    label: "Condição (Se)",
    descricao: "Divide o fluxo em dois caminhos: verdadeiro e falso.",
    categoria: "Lógica",
    icone: "GitBranch",
    cor: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    temEntrada: true,
    saidas: [
      { id: "true", label: "Verdadeiro" },
      { id: "false", label: "Falso" },
    ],
    campos: [
      {
        key: "campo",
        label: "Campo",
        kind: "text",
        placeholder: "webhook.data.key.fromMe",
        help: "Caminho de uma variável, ex.: lead.temCampanha ou {{telefone}}.",
      },
      {
        key: "operador",
        label: "Operador",
        kind: "select",
        options: OPERADORES.map((o) => ({ value: o.value, label: o.label })),
      },
      { key: "valor", label: "Valor", kind: "text", placeholder: "Comparar com…", help: "Aceita variáveis {{...}}." },
    ],
    padrao: { campo: "", operador: "igual", valor: "" },
  },
  buscar_lead: {
    type: "buscar_lead",
    label: "Buscar lead pelo telefone",
    descricao: "Procura o lead no banco do app (ignora o código do país e o 9º dígito).",
    categoria: "Dados",
    icone: "UserSearch",
    cor: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    temEntrada: true,
    saidas: [{ id: "main", label: "" }],
    campos: [
      {
        key: "telefone",
        label: "Telefone",
        kind: "text",
        placeholder: "{{telefone}}",
        help: "Resultado: lead.encontrado, lead.id, lead.nome, lead.status, lead.temCampanha, lead.campanhasIds.",
      },
    ],
    padrao: { telefone: "{{telefone}}" },
  },
  registrar_resposta: {
    type: "registrar_resposta",
    label: "Registrar resposta do lead",
    descricao: "Grava a resposta na timeline, tira o lead das campanhas e marca como “respondeu”.",
    categoria: "Ação",
    icone: "MessageSquareReply",
    cor: "bg-primary/15 text-primary",
    temEntrada: true,
    saidas: [{ id: "main", label: "" }],
    campos: [],
    padrao: {},
  },
  enviar_mensagem: {
    type: "enviar_mensagem",
    label: "Enviar mensagem WhatsApp",
    descricao: "Envia um texto pela instância mais recente do app.",
    categoria: "Ação",
    icone: "Send",
    cor: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
    temEntrada: true,
    saidas: [{ id: "main", label: "" }],
    campos: [
      { key: "telefone", label: "Telefone", kind: "text", placeholder: "{{telefone}}" },
      {
        key: "texto",
        label: "Mensagem",
        kind: "textarea",
        placeholder: "Olá, {{lead.nome}}!",
        help: "Aceita variáveis {{...}}.",
      },
    ],
    padrao: { telefone: "{{telefone}}", texto: "" },
  },
  aguardar: {
    type: "aguardar",
    label: "Aguardar",
    descricao: "Espera alguns segundos antes de seguir (máximo de 30).",
    categoria: "Lógica",
    icone: "Timer",
    cor: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
    temEntrada: true,
    saidas: [{ id: "main", label: "" }],
    campos: [{ key: "segundos", label: "Segundos", kind: "number", placeholder: "5" }],
    padrao: { segundos: 5 },
  },
  ignorar: {
    type: "ignorar",
    label: "Encerrar (ignorar)",
    descricao: "Termina o fluxo marcando a execução como ignorada.",
    categoria: "Lógica",
    icone: "Ban",
    cor: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
    temEntrada: true,
    saidas: [],
    campos: [],
    padrao: {},
  },
}

export const ORDEM_CATEGORIAS: Categoria[] = ["Gatilho", "Lógica", "Dados", "Ação"]

/** Dimensões usadas pelo canvas e para posicionar as conexões. */
export const NODE_LARGURA = 232
export const NODE_ALTURA_BASE = 68
export function alturaDoNo(type: NodeType): number {
  const saidas = NODE_CATALOG[type].saidas.length
  return saidas > 1 ? NODE_ALTURA_BASE + 24 * (saidas - 1) : NODE_ALTURA_BASE
}
export function posicaoSaida(node: FlowNode, handle: string): { x: number; y: number } {
  const def = NODE_CATALOG[node.type]
  const indice = Math.max(0, def.saidas.findIndex((s) => s.id === handle))
  const altura = alturaDoNo(node.type)
  return { x: node.position.x + NODE_LARGURA, y: node.position.y + (altura * (indice + 1)) / (def.saidas.length + 1) }
}
export function posicaoEntrada(node: FlowNode): { x: number; y: number } {
  return { x: node.position.x, y: node.position.y + alturaDoNo(node.type) / 2 }
}

export function novoId(prefixo = "n"): string {
  const aleatorio =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12)
  return `${prefixo}_${aleatorio}`
}

export function gerarToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return `nc_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`
}

export function criarNo(type: NodeType, position: { x: number; y: number }): FlowNode {
  const def = NODE_CATALOG[type]
  const config: NodeConfig = { ...def.padrao }
  if (type === "webhook") config.token = gerarToken()
  return { id: novoId(), type, name: def.label, position, config }
}

/** Valida o grafo antes de salvar/ativar. Devolve a mensagem de erro ou null. */
export function validarGrafo(nodes: FlowNode[], edges: FlowEdge[], exigirGatilho = false): string | null {
  const ids = new Set<string>()
  for (const no of nodes) {
    if (!NODE_CATALOG[no.type]) return `Bloco desconhecido: ${String(no.type)}.`
    if (ids.has(no.id)) return "Há blocos com o mesmo identificador."
    ids.add(no.id)
  }
  if (nodes.filter((n) => n.type === "webhook").length > 1) return "Use apenas um gatilho Webhook por fluxo."
  if (exigirGatilho && !nodes.some((n) => n.type === "webhook")) return "Adicione um bloco Webhook (gatilho) ao fluxo."
  for (const aresta of edges) {
    const origem = nodes.find((n) => n.id === aresta.source)
    if (!origem || !ids.has(aresta.target)) return "Há conexões apontando para blocos inexistentes."
    if (!NODE_CATALOG[origem.type].saidas.some((s) => s.id === aresta.sourceHandle)) return "Conexão com saída inválida."
    const destino = nodes.find((n) => n.id === aresta.target)
    if (destino && !NODE_CATALOG[destino.type].temEntrada) return "O gatilho não pode receber conexões."
  }
  return null
}

/** Exemplo de evento da Evolution (messages.upsert) usado nos testes. */
export const PAYLOAD_EXEMPLO = {
  event: "messages.upsert",
  instance: "minha-instancia",
  data: {
    key: { remoteJid: "557991054765@s.whatsapp.net", fromMe: false, id: "A543C365BDE2A106BEA482E66CCE70E8" },
    pushName: "Contato de teste",
    message: { conversation: "Olá, tenho interesse!" },
    messageType: "conversation",
    messageTimestamp: 1788356875,
  },
}

/**
 * Modelo "Fluxo de resposta": o mesmo caminho que era feito no n8n —
 * Webhook → telefone → ignora mensagens nossas → busca o lead → só segue se o
 * lead estiver em campanha → registra a resposta.
 */
export function modeloFluxoResposta(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const gatilho = criarNo("webhook", { x: 40, y: 150 })
  const telefone = criarNo("extrair_telefone", { x: 340, y: 150 })
  const proprio = criarNo("condicao", { x: 640, y: 150 })
  proprio.name = "Mensagem não é nossa?"
  proprio.config = { campo: "webhook.data.key.fromMe", operador: "falso", valor: "" }
  const buscar = criarNo("buscar_lead", { x: 940, y: 80 })
  const emCampanha = criarNo("condicao", { x: 1240, y: 80 })
  emCampanha.name = "Lead está em campanha?"
  emCampanha.config = { campo: "lead.temCampanha", operador: "verdadeiro", valor: "" }
  const registrar = criarNo("registrar_resposta", { x: 1540, y: 20 })
  const fim1 = criarNo("ignorar", { x: 940, y: 270 })
  fim1.name = "Ignorar (mensagem nossa)"
  const fim2 = criarNo("ignorar", { x: 1540, y: 200 })
  fim2.name = "Ignorar (lead fora de campanha)"

  const liga = (a: FlowNode, handle: string, b: FlowNode): FlowEdge => ({
    id: novoId("e"),
    source: a.id,
    sourceHandle: handle,
    target: b.id,
  })
  return {
    nodes: [gatilho, telefone, proprio, buscar, emCampanha, registrar, fim1, fim2],
    edges: [
      liga(gatilho, "main", telefone),
      liga(telefone, "main", proprio),
      liga(proprio, "true", buscar),
      liga(proprio, "false", fim1),
      liga(buscar, "main", emCampanha),
      liga(emCampanha, "true", registrar),
      liga(emCampanha, "false", fim2),
    ],
  }
}
