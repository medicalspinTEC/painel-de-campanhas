/**
 * Erros do MCP que viram resposta estruturada e legível (nunca uma falha crua do servidor).
 *
 *  - `McpEntradaInvalidaError`: o pedido está errado (filtro inexistente, período invertido, página fora do
 *    intervalo...). Vira `{ ok: false, codigo: "ENTRADA_INVALIDA", campo, erro }`. NUNCA é convertido em lista vazia.
 *  - Qualquer outro erro é tratado como falha técnica em `registrar` (lib/mcp/server.ts): o cliente recebe só
 *    `codigo: "ERRO_TECNICO"` + correlationId; o detalhe interno fica no log do servidor.
 */
export class McpEntradaInvalidaError extends Error {
  readonly campo: string
  readonly dica?: string

  constructor(campo: string, mensagem: string, dica?: string) {
    super(mensagem)
    this.name = "McpEntradaInvalidaError"
    this.campo = campo
    this.dica = dica
  }
}

/**
 * Gancho de TESTE: simula a queda de uma dependência (banco, serviço externo) numa ferramenta.
 * Só funciona fora de produção (NODE_ENV !== "production") e só quando MCP_TESTE_FALHA_FERRAMENTA contém o nome
 * da ferramenta (ou "*"). A falha é lançada ANTES de qualquer leitura/gravação, então nada é alterado.
 */
export function falhaSimuladaPara(ferramenta: string): boolean {
  if (process.env.NODE_ENV === "production") return false
  const alvo = process.env.MCP_TESTE_FALHA_FERRAMENTA?.trim()
  if (!alvo) return false
  return alvo === "*" || alvo.split(",").map((n) => n.trim()).includes(ferramenta)
}

export class DependenciaSimuladaError extends Error {
  constructor() {
    // Texto propositalmente "sujo" (host, usuário, SQL) para provar que nada disso vaza ao cliente MCP.
    super('simulado: connect ECONNREFUSED 10.0.0.5:5432 (postgresql://app_user:***@db.interno/campanhas) in "SELECT * FROM Lead"')
    this.name = "DependenciaSimuladaError"
  }
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/

/** Converte "AAAA-MM-DD" ou ISO completo em Date; data só com dia: `fimDoDia` vai até 23:59:59.999. */
export function lerDataFiltro(campo: string, valor: string | undefined, fimDoDia = false): Date | undefined {
  if (valor === undefined) return undefined
  const texto = valor.trim()
  if (!DATA_ISO.test(texto)) {
    throw new McpEntradaInvalidaError(campo, `O filtro "${campo}" precisa ser uma data válida (AAAA-MM-DD ou ISO 8601). Recebido: "${valor}".`)
  }
  const somenteDia = texto.length === 10
  const data = new Date(somenteDia ? `${texto}T${fimDoDia ? "23:59:59.999" : "00:00:00.000"}Z` : texto)
  if (Number.isNaN(data.getTime())) {
    throw new McpEntradaInvalidaError(campo, `O filtro "${campo}" não é uma data válida: "${valor}".`)
  }
  return data
}
