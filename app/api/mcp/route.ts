import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"

import { createAppMcpServer } from "@/lib/mcp/server"
import { runInWorkspace } from "@/lib/workspace-context"
import { workspaceDoTokenMcp } from "@/services/mcp-token"

/**
 * Endpoint MCP (Model Context Protocol) do painel.
 *
 * Permite conectar um cliente MCP — Claude.ai (Connectors), Claude Desktop,
 * Claude Code, etc. — a UMA instância do painel, dando a ele as tools de
 * `lib/mcp/server.ts` — somente as funções que o dono do token liberou em Integrações
 * (`McpToken.ferramentas`), e respeitando os plugins ativos de cada função.
 *
 * Autenticação: cada instância gera o próprio token do MCP em Integrações
 * (`services/mcp-token.ts`). O MCP vem desligado: sem token válido a rota recusa
 * a chamada (401), e as ferramentas rodam SOMENTE na instância dona do token —
 * nunca nas demais. Quem não gerar o token não expõe nada.
 *
 * O token pode ir em qualquer um destes lugares:
 *  - `Authorization: Bearer mcp_…`  (preferido)
 *  - `x-mcp-token: mcp_…`
 *  - `?token=mcp_…` na URL (para conectores do claude.ai, que só pedem a URL;
 *    trate a URL como senha, pois URLs podem aparecer em logs)
 * O `API_TOKEN` e a sessão do navegador NÃO dão acesso ao MCP.
 *
 * Modo stateless: cada requisição cria um servidor e um transporte novos, sem
 * `sessionIdGenerator` — não há sessão MCP persistida em memória entre
 * chamadas. Isso é o que permite rodar em ambientes serverless (Vercel) sem
 * afinidade de instância; o cliente MCP reenvia o contexto necessário a cada
 * chamada, como o próprio protocolo Streamable HTTP prevê.
 */

function extrairToken(request: Request): string | null {
  const auth = request.headers.get("authorization")
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim() || null
  const dedicado = request.headers.get("x-mcp-token")?.trim()
  if (dedicado) return dedicado
  return new URL(request.url).searchParams.get("token")?.trim() || null
}

function naoAutorizado(mensagem: string) {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message: mensagem }, id: null },
    { status: 401, headers: { "www-authenticate": 'Bearer realm="mcp"', "cache-control": "no-store" } },
  )
}

export async function POST(request: Request) {
  const token = extrairToken(request)
  if (!token) return naoAutorizado("Token do MCP ausente. Gere um em Integrações e envie em Authorization: Bearer.")

  const acesso = await workspaceDoTokenMcp(token)
  if (!acesso) return naoAutorizado("Token do MCP inválido, desativado ou removido.")

  // Tudo abaixo roda dentro da instância dona do token, só com as funções que ele liberou.
  return runInWorkspace(acesso.workspaceId, () => processarMcp(request, acesso.ferramentas))
}

async function processarMcp(request: Request, ferramentas: readonly string[]) {
  const server = await createAppMcpServer({ ferramentas })
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
