import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"

import { createAppMcpServer } from "@/lib/mcp/server"

/**
 * Endpoint MCP (Model Context Protocol) do painel.
 *
 * Permite conectar um cliente MCP — Claude.ai (Connectors), Claude Desktop,
 * Claude Code, etc. — diretamente a esta aplicação, dando a ele acesso às
 * tools declaradas em `lib/mcp/server.ts` (leads, campanhas, produtos,
 * indicadores e eventos).
 *
 * Autenticação: por decisão explícita, esta rota está PÚBLICA (ver
 * `proxy.ts`) — contas comuns do claude.ai (fora do Claude Code) ainda não
 * suportam enviar um header fixo de autenticação para conectores
 * personalizados, e exigir o `API_TOKEN` aqui impediria a conexão. Isso quer
 * dizer que qualquer pessoa com esta URL consegue ler e alterar leads e
 * campanhas — é uma troca deliberada de simplicidade por segurança, válida
 * enquanto o claude.ai não suportar headers customizados (ou enquanto você
 * não quiser trocar para OAuth). Para voltar a exigir o `API_TOKEN` nesta
 * rota, defina `MCP_EXIGIR_TOKEN=true` no `.env` (não é preciso editar código).
 *
 * Modo stateless: cada requisição cria um servidor e um transporte novos, sem
 * `sessionIdGenerator` — não há sessão MCP persistida em memória entre
 * chamadas. Isso é o que permite rodar em ambientes serverless (Vercel) sem
 * afinidade de instância; o cliente MCP reenvia o contexto necessário a cada
 * chamada, como o próprio protocolo Streamable HTTP prevê.
 */

export async function POST(request: Request) {
  const server = createAppMcpServer()
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  try {
    await server.connect(transport)
    const response = await transport.handleRequest(request)
    return response
  } catch (error) {
    console.error("[api/mcp] Falha ao processar requisição MCP:", error)
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "Erro interno do servidor MCP." }, id: null },
      { status: 500 },
    )
  } finally {
    await transport.close()
    await server.close()
  }
}

function metodoNaoSuportado() {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Método não suportado neste endpoint stateless." }, id: null },
    { status: 405 },
  )
}

export async function GET() {
  return metodoNaoSuportado()
}

export async function DELETE() {
  return metodoNaoSuportado()
}
