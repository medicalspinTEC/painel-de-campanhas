-- Funções que cada token do MCP pode executar (escolhidas na tela de Integrações antes de gerar o token).
ALTER TABLE "McpToken" ADD COLUMN "ferramentas" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Tokens já existentes mantêm exatamente as funções que o MCP tinha até agora; nada novo é liberado sem o usuário escolher.
UPDATE "McpToken" SET "ferramentas" = ARRAY['listar_leads', 'buscar_negocio_bdr', 'obter_lead', 'criar_lead', 'atualizar_status_lead', 'anotar_lead', 'enviar_mensagem_lead', 'listar_campanhas', 'obter_campanha', 'criar_campanha', 'definir_status_campanha', 'listar_produtos', 'obter_indicadores', 'listar_respostas_lead', 'obter_envio', 'listar_eventos_recentes']::TEXT[];

ALTER TABLE "McpToken" ALTER COLUMN "ferramentas" SET NOT NULL;
