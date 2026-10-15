# Roteiro de validação do MCP (pendências 1 a 6)

Ambiente de TESTE, nunca produção. Chame as ferramentas pelo cliente MCP (Claude, Inspector etc.).

0. `WORKSPACE_ID=… npx tsx scripts/mcp-integridade.ts antes > antes.json`
1. **Paginação independente** — `listar_leads`, `listar_respostas_lead`, `listar_envios`, `listar_eventos_recentes`:
   - sem lote/pagina → só `itens` da página 1 (≤ 50), com `totalRegistros`, `temProximaPagina`, `proximo`, `temProximoLote`, `proximoLote`;
   - `lote=1, pagina=2` → só a página 2; seguir `proximo` até `temProximaPagina=false` soma exatamente `totalRegistros`;
   - `listar_departamentos`: `loteBots/paginaBots` andam sem mexer nos departamentos.
2. **Envios** — `listar_envios` com `campanhaId`, `leadId`, `de/ate` (ex.: `2026-10-01`/`2026-10-15`) e `resultado=enviado|falha`, isolados e combinados; conferir contra a contagem do banco.
3. **Respostas** — `listar_respostas_lead` com `leadId`/`campanhaId` e `pagina=2`: filtros mantidos, total igual ao do filtro.
4. **Filtros inválidos** (esperado `ok=false`, `codigo=ENTRADA_INVALIDA`, `campo`, mensagem legível; nunca lista vazia):
   `campanhaId="xxx"`, `leadId="xxx"`, `de="ontem"`, `de=2026-10-15 ate=2026-10-01`, `lote=99`, `pagina=13`, `busca="  "`, `departamentoId="xxx"`.
5. **Erro técnico** — subir o servidor de teste com `NODE_ENV=development MCP_TESTE_FALHA_FERRAMENTA=listar_envios` e chamar `listar_envios`:
   esperado `ok=false`, `codigo=ERRO_TECNICO`, `correlationId`, SEM host/SQL/stack; o detalhe só aparece no log do servidor (e em `erroInterno` no log do painel). Em produção o gancho é ignorado.
6. `WORKSPACE_ID=… npx tsx scripts/mcp-integridade.ts depois antes.json` → deve imprimir `INTEGRIDADE APROVADA`.
