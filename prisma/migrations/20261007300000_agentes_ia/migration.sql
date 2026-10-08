-- Plugin Agentes de IA: agentes de atendimento (Claude) vinculados a departamentos e/ou à entrada.
ALTER TABLE "Settings" ADD COLUMN "agentesIaPluginAtivo" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AgenteIA" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "provedor" TEXT NOT NULL DEFAULT 'claude',
    "modelo" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL,
    "entrada" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgenteIA_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgenteIA_workspaceId_idx" ON "AgenteIA"("workspaceId");
-- No máximo um agente de entrada por instância.
CREATE UNIQUE INDEX "AgenteIA_workspaceId_entrada_key" ON "AgenteIA"("workspaceId") WHERE "entrada" = true;

ALTER TABLE "Departamento" ADD COLUMN "agenteIaId" TEXT;
CREATE INDEX "Departamento_agenteIaId_idx" ON "Departamento"("agenteIaId");

ALTER TABLE "Departamento"
  ADD CONSTRAINT "Departamento_agenteIaId_fkey"
  FOREIGN KEY ("agenteIaId") REFERENCES "AgenteIA"("id") ON DELETE SET NULL ON UPDATE CASCADE;
