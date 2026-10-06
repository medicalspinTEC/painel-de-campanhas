/**
 * Catálogo dos blocos do plugin No Code. Compartilhado entre o editor (cliente)
 * e o motor de execução (servidor) — por isso não importa nada de React/Prisma.
 *
 * Os blocos são fixos (sem JavaScript livre): cada um faz uma coisa e é
 * configurado por campos. Valores de texto aceitam variáveis `{{caminho}}`.
 */

import { PLUGIN_NOME, type PluginKey } from "@/lib/plugins"

export type NodeType =
  | "webhook"
  | "extrair_telefone"
  | "condicao"
  | "buscar_lead"
  | "registrar_resposta"
  | "enviar_mensagem"
  | "aguardar"
  | "ignorar"
  // Blocos exclusivos de bots (conversa com o lead no chat).
  | "mensagem_recebida"
  | "menu"
  | "transferir_departamento"
  | "transferir_atendente"
  // Lógica: segue por "Verdadeiro" ou "Falso" conforme o plugin escolhido esteja ativo.
  | "plugin_ativo"

/** "automacao": disparada pelo webhook da Evolution. "bot": responde conversas do chat. */
export type FlowKind = "automacao" | "bot"

/**
 * Todos os blocos estão disponíveis em qualquer fluxo (automação ou bot). Os que precisam de
 * contexto que o fluxo não tem (ex.: Menu e Transferir só têm lead em conversa dentro de um bot)
 * avisam com erro claro ao executar; use "Plugin ativo" e "Condição" para desviar o caminho.
 */
export function blocoPermitido(_type: NodeType, _kind: FlowKind): boolean {
  return true
}

/** Plugins que o bloco "Plugin ativo" pode verificar. */
export const PLUGINS_VERIFICAVEIS: PluginKey[] = ["chat", "kanban", "assistente", "nocode", "crm"]

/** Gatilho de cada tipo de fluxo. */
export function gatilhoDoTipo(kind: FlowKind): NodeType {
  return kind === "bot" ? "mensagem_recebida" : "webhook"
}

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
  /** "atendente": lista de atendentes ativos cadastrados no CRM (o valor guardado é o id). */
  kind: "text" | "textarea" | "select" | "switch" | "number" | "atendente"
  /** Só mostra o campo quando outro campo do bloco tem este valor. */
  mostrarSe?: { key: string; value: string }
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
  icone:
    | "Webhook"
    | "Phone"
    | "GitBranch"
    | "UserSearch"
    | "MessageSquareReply"
    | "Send"
    | "Timer"
    | "Ban"
    | "MessageCircle"
    | "ListOrdered"
    | "Building2"
    | "UserCheck"
    | "Puzzle"
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
  plugin_ativo: {
    type: "plugin_ativo",
    label: "Plugin ativo",
    descricao: "Verifica se um plugin está ativo e segue por “Verdadeiro” (ativo) ou “Falso” (desativado).",
    categoria: "Lógica",
    icone: "Puzzle",
    cor: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    temEntrada: true,
    saidas: [
      { id: "true", label: "Ativo" },
      { id: "false", label: "Desativado" },
    ],
    campos: [
      {
        key: "plugin",
        label: "Plugin",
        kind: "select",
        options: PLUGINS_VERIFICAVEIS.map((p) => ({ value: p, label: PLUGIN_NOME[p] })),
        help: "O bloco consulta o estado do plugin no momento da execução.",
      },
    ],
    padrao: { plugin: "crm" },
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
  mensagem_recebida: {
    type: "mensagem_recebida",
    label: "Mensagem recebida (bot)",
    descricao: "Inicia o bot quando o lead envia uma mensagem e não há um humano na conversa.",
    categoria: "Gatilho",
    icone: "MessageCircle",
    cor: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    temEntrada: false,
    saidas: [{ id: "main", label: "" }],
    campos: [
      {
        key: "reiniciarAposHoras",
        label: "Recomeçar após (horas)",
        kind: "number",
        placeholder: "12",
        help: "Quando o lead escreve de novo depois desse tempo, o bot recomeça do início; antes disso ele não repete a resposta. 0 = recomeça a cada mensagem. Um menu sem resposta expira em 24 h.",
      },
    ],
    padrao: { reiniciarAposHoras: 12 },
  },
  menu: {
    type: "menu",
    label: "Menu de opções",
    descricao: "Envia uma pergunta com opções numeradas e espera o lead escolher. Cada opção vira uma saída.",
    categoria: "Ação",
    icone: "ListOrdered",
    cor: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
    temEntrada: true,
    // As saídas reais vêm das opções: ver `saidasDoNo`.
    saidas: [{ id: "outra", label: "Outra resposta" }],
    campos: [
      {
        key: "texto",
        label: "Mensagem",
        kind: "textarea",
        placeholder: "Olá, {{lead.nome}}! Com qual departamento você quer falar?",
        help: "As opções são acrescentadas abaixo, numeradas. Aceita variáveis {{...}}.",
      },
      {
        key: "opcoes",
        label: "Opções (uma por linha)",
        kind: "textarea",
        placeholder: "Comercial\nSuporte\nFinanceiro",
        help: "Até 9 opções. O lead responde com o número ou com o texto da opção.",
      },
      {
        key: "textoInvalido",
        label: "Resposta inválida",
        kind: "textarea",
        placeholder: "Não entendi. Responda com o número de uma das opções.",
        help: "Enviada junto com o menu quando o lead responde algo que não é uma opção (se a saída “Outra resposta” estiver desconectada).",
      },
    ],
    padrao: {
      texto: "Olá! Como podemos ajudar? Escolha uma opção:",
      opcoes: "Comercial\nSuporte",
      textoInvalido: "Não entendi. Responda com o número de uma das opções.",
    },
  },
  transferir_atendente: {
    type: "transferir_atendente",
    label: "Transferir para atendente",
    descricao:
      "Passa a conversa para uma pessoa: um atendente escolhido ou, na distribuição, o que tem menos conversas. O bot para de responder.",
    categoria: "Ação",
    icone: "UserCheck",
    cor: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
    temEntrada: true,
    saidas: [
      { id: "main", label: "Transferido" },
      { id: "sem_atendente", label: "Sem atendente" },
    ],
    campos: [
      {
        key: "modo",
        label: "Como escolher",
        kind: "select",
        options: [
          { value: "balanceado", label: "Distribuir entre os atendentes" },
          { value: "especifico", label: "Atendente específico" },
        ],
        help: "Distribuir: a conversa vai para o atendente com menos conversas atribuídas (em empate, sorteia entre eles).",
      },
      {
        key: "atendenteId",
        label: "Atendente",
        kind: "atendente",
        mostrarSe: { key: "modo", value: "especifico" },
      },
      {
        key: "departamento",
        label: "Só atendentes do departamento",
        kind: "text",
        placeholder: "(todos os atendentes)",
        mostrarSe: { key: "modo", value: "balanceado" },
        help: "Opcional. Em branco, a distribuição considera todos os atendentes ativos; com um nome, só os desse departamento (e a conversa passa a pertencer a ele).",
      },
    ],
    padrao: { modo: "balanceado", atendenteId: "", departamento: "" },
  },
  transferir_departamento: {
    type: "transferir_departamento",
    label: "Transferir para departamento",
    descricao: "Coloca a conversa na fila de um departamento (o bot desse departamento passa a atender).",
    categoria: "Ação",
    icone: "Building2",
    cor: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    temEntrada: true,
    saidas: [{ id: "main", label: "" }],
    campos: [
      {
        key: "departamento",
        label: "Nome do departamento",
        kind: "text",
        placeholder: "Comercial",
        help: "Precisa ser igual ao nome cadastrado em CRM → Departamentos (ignora maiúsculas).",
      },
      {
        key: "pausarBot",
        label: "Pausar o bot nesta conversa",
        kind: "switch",
        help: "Ligado: o bot para de responder até alguém reativá-lo no chat (use para entregar a um humano).",
      },
    ],
    padrao: { departamento: "", pausarBot: false },
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

export const MENU_MAX_OPCOES = 9

/** Opções de um bloco Menu: uma por linha, sem linhas vazias nem repetidas. */
export function opcoesDoMenu(config: NodeConfig): string[] {
  const vistas = new Set<string>()
  const lista: string[] = []
  for (const linha of String(config.opcoes ?? "").split(/\r?\n/)) {
    const texto = linha.trim()
    if (!texto || vistas.has(texto.toLowerCase())) continue
    vistas.add(texto.toLowerCase())
    lista.push(texto)
    if (lista.length >= MENU_MAX_OPCOES) break
  }
  return lista
}

const semAcento = (texto: string) =>
  texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ")

/**
 * Qual opção do menu o lead escolheu: devolve o índice (0 = primeira) ou -1 se a resposta não
 * corresponde a nenhuma. Aceita o número ("2", "2.", "2)"), o texto exato da opção ou uma frase
 * que contenha o texto de UMA só opção ("quero o suporte"). Ignora maiúsculas e acentos.
 */
export function escolherOpcao(resposta: string, opcoes: string[]): number {
  const limpo = semAcento(resposta)
  if (!limpo) return -1
  const numero = limpo.match(/^(\d{1,2})\s*[-.)]?$/)
  if (numero) {
    const n = Number(numero[1])
    return n >= 1 && n <= opcoes.length ? n - 1 : -1
  }
  const exata = opcoes.findIndex((o) => semAcento(o) === limpo)
  if (exata >= 0) return exata
  const contidas = opcoes.map((o, i) => (semAcento(o) && limpo.includes(semAcento(o)) ? i : -1)).filter((i) => i >= 0)
  return contidas.length === 1 ? contidas[0] : -1
}

/** Saídas reais de um bloco (o Menu tem uma por opção, as demais vêm do catálogo). */
export function saidasDoNo(no: Pick<FlowNode, "type" | "config">): { id: string; label: string }[] {
  if (no.type === "menu") {
    const opcoes = opcoesDoMenu(no.config ?? {})
    return [
      ...opcoes.map((texto, i) => ({ id: `op_${i + 1}`, label: `${i + 1}. ${texto.length > 18 ? `${texto.slice(0, 17)}…` : texto}` })),
      { id: "outra", label: "Outra resposta" },
    ]
  }
  return NODE_CATALOG[no.type].saidas
}

/** Descarta conexões que saem de uma saída que não existe mais (ex.: opção removida de um menu). */
export function podarArestas(nodes: FlowNode[], edges: FlowEdge[]): FlowEdge[] {
  return edges.filter((aresta) => {
    const origem = nodes.find((n) => n.id === aresta.source)
    return Boolean(origem) && saidasDoNo(origem!).some((s) => s.id === aresta.sourceHandle)
  })
}

export function alturaDoNo(no: Pick<FlowNode, "type" | "config">): number {
  const saidas = saidasDoNo(no).length
  return saidas > 1 ? NODE_ALTURA_BASE + 24 * (saidas - 1) : NODE_ALTURA_BASE
}
export function posicaoSaida(node: FlowNode, handle: string): { x: number; y: number } {
  const saidas = saidasDoNo(node)
  const indice = Math.max(0, saidas.findIndex((s) => s.id === handle))
  const altura = alturaDoNo(node)
  return { x: node.position.x + NODE_LARGURA, y: node.position.y + (altura * (indice + 1)) / (saidas.length + 1) }
}
export function posicaoEntrada(node: FlowNode): { x: number; y: number } {
  return { x: node.position.x, y: node.position.y + alturaDoNo(node) / 2 }
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
export function validarGrafo(
  nodes: FlowNode[],
  edges: FlowEdge[],
  exigirGatilho = false,
  kind: FlowKind = "automacao",
): string | null {
  const ids = new Set<string>()
  for (const no of nodes) {
    if (!NODE_CATALOG[no.type]) return `Bloco desconhecido: ${String(no.type)}.`
    if (ids.has(no.id)) return "Há blocos com o mesmo identificador."
    ids.add(no.id)
  }
  const gatilho = gatilhoDoTipo(kind)
  const rotulo = NODE_CATALOG[gatilho].label
  if (nodes.filter((n) => n.type === gatilho).length > 1) return `Use apenas um gatilho “${rotulo}” por fluxo.`
  if (exigirGatilho && !nodes.some((n) => n.type === gatilho)) return `Adicione um bloco “${rotulo}” (gatilho) ao fluxo.`
  for (const aresta of edges) {
    const origem = nodes.find((n) => n.id === aresta.source)
    if (!origem || !ids.has(aresta.target)) return "Há conexões apontando para blocos inexistentes."
    if (!saidasDoNo(origem).some((s) => s.id === aresta.sourceHandle)) return "Conexão com saída inválida."
    const destino = nodes.find((n) => n.id === aresta.target)
    if (destino && !NODE_CATALOG[destino.type].temEntrada) return "O gatilho não pode receber conexões."
  }
  for (const no of nodes) {
    if (no.type !== "menu") continue
    if (opcoesDoMenu(no.config ?? {}).length < 2) return `O menu “${no.name}” precisa de pelo menos 2 opções.`
    if (!String(no.config?.texto ?? "").trim()) return `O menu “${no.name}” precisa de uma mensagem.`
  }
  for (const no of nodes) {
    if (no.type === "transferir_atendente" && no.config?.modo === "especifico" && !String(no.config?.atendenteId ?? "").trim()) {
      return `Escolha o atendente do bloco “${no.name}”.`
    }
    if (no.type === "plugin_ativo" && !PLUGINS_VERIFICAVEIS.includes(no.config?.plugin as PluginKey)) {
      return `Escolha o plugin do bloco “${no.name}”.`
    }
  }
  return null
}

/** Modelo inicial de um bot de triagem: pergunta o departamento e responde conforme a opção. */
export function modeloBotTriagem(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const gatilho = criarNo("mensagem_recebida", { x: 40, y: 140 })
  const menu = criarNo("menu", { x: 340, y: 120 })
  menu.name = "Escolha o departamento"
  const comercial = criarNo("enviar_mensagem", { x: 700, y: 20 })
  comercial.name = "Resposta: Comercial"
  comercial.config = { telefone: "{{telefone}}", texto: "Certo! Já vamos te passar para o Comercial." }
  const suporte = criarNo("enviar_mensagem", { x: 700, y: 180 })
  suporte.name = "Resposta: Suporte"
  suporte.config = { telefone: "{{telefone}}", texto: "Certo! Já vamos te passar para o Suporte." }
  const liga = (a: FlowNode, handle: string, b: FlowNode): FlowEdge => ({
    id: novoId("e"),
    source: a.id,
    sourceHandle: handle,
    target: b.id,
  })
  return {
    nodes: [gatilho, menu, comercial, suporte],
    edges: [liga(gatilho, "main", menu), liga(menu, "op_1", comercial), liga(menu, "op_2", suporte)],
  }
}

/** Modelo inicial de um bot de departamento: uma resposta simples. */
export function modeloBotDepartamento(): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const gatilho = criarNo("mensagem_recebida", { x: 40, y: 100 })
  const resposta = criarNo("enviar_mensagem", { x: 340, y: 80 })
  resposta.config = { telefone: "{{telefone}}", texto: "Olá, {{lead.nome}}! Recebemos sua mensagem e um atendente vai responder em breve." }
  return {
    nodes: [gatilho, resposta],
    edges: [{ id: novoId("e"), source: gatilho.id, sourceHandle: "main", target: resposta.id }],
  }
}

/** Evento de exemplo usado para testar um bot no editor. */
export const MENSAGEM_EXEMPLO_BOT = { mensagem: "1" }

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
