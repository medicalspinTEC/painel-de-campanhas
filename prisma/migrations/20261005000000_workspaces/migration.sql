-- Instâncias (workspaces): cada admin passa a ter um espaço de dados isolado.
-- Os dados existentes ficam na instância principal (a do Root).

-- 1) Tabela de instâncias + instância principal (única).
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Workspace_principal_unica" ON "Workspace"("principal") WHERE "principal" = true;

INSERT INTO "Workspace" ("id", "nome", "principal", "atualizadoEm")
VALUES ('ws_principal', 'Principal', true, CURRENT_TIMESTAMP);

-- 2) Cada admin que já existe ganha a própria instância (vazia).
INSERT INTO "Workspace" ("id", "nome", "principal", "atualizadoEm")
SELECT 'ws_' || "id", "nome", false, CURRENT_TIMESTAMP FROM "User" WHERE "role" = 'admin';

-- 3) Usuários: admin na própria instância; os demais (root e padrão) na principal.
ALTER TABLE "User" ADD COLUMN "workspaceId" TEXT;
UPDATE "User" SET "workspaceId" = 'ws_' || "id" WHERE "role" = 'admin';
UPDATE "User" SET "workspaceId" = 'ws_principal' WHERE "workspaceId" IS NULL;
ALTER TABLE "User" ALTER COLUMN "workspaceId" SET NOT NULL;
CREATE INDEX "User_workspaceId_idx" ON "User"("workspaceId");

-- 4) Demais tabelas de dados: tudo que já existe pertence à instância principal.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Lead', 'Campaign', 'Webhook', 'AppLog', 'InboundEvent', 'Instance',
    'NoCodeFlow', 'BackupExecucao', 'Produto', 'Marca', 'Persona', 'Regiao', 'Departamento'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN "workspaceId" TEXT', t);
    EXECUTE format('UPDATE %I SET "workspaceId" = ''ws_principal''', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "workspaceId" SET NOT NULL', t);
  END LOOP;
END $$;

CREATE INDEX "Lead_workspaceId_idx" ON "Lead"("workspaceId");
CREATE INDEX "Campaign_workspaceId_idx" ON "Campaign"("workspaceId");
CREATE INDEX "Webhook_workspaceId_idx" ON "Webhook"("workspaceId");
CREATE INDEX "AppLog_workspaceId_idx" ON "AppLog"("workspaceId");
CREATE INDEX "InboundEvent_workspaceId_idx" ON "InboundEvent"("workspaceId");
CREATE INDEX "Instance_workspaceId_idx" ON "Instance"("workspaceId");
CREATE INDEX "NoCodeFlow_workspaceId_idx" ON "NoCodeFlow"("workspaceId");
CREATE INDEX "BackupExecucao_workspaceId_idx" ON "BackupExecucao"("workspaceId");

-- 5) Catálogos e departamentos: o nome (e o ID de importação) passa a ser único POR instância.
DROP INDEX "Produto_nome_key";
DROP INDEX "Produto_idImportacao_key";
CREATE UNIQUE INDEX "Produto_workspaceId_nome_key" ON "Produto"("workspaceId", "nome");
CREATE UNIQUE INDEX "Produto_workspaceId_idImportacao_key" ON "Produto"("workspaceId", "idImportacao");

DROP INDEX "Marca_nome_key";
DROP INDEX "Marca_idImportacao_key";
CREATE UNIQUE INDEX "Marca_workspaceId_nome_key" ON "Marca"("workspaceId", "nome");
CREATE UNIQUE INDEX "Marca_workspaceId_idImportacao_key" ON "Marca"("workspaceId", "idImportacao");

DROP INDEX "Persona_nome_key";
DROP INDEX "Persona_idImportacao_key";
CREATE UNIQUE INDEX "Persona_workspaceId_nome_key" ON "Persona"("workspaceId", "nome");
CREATE UNIQUE INDEX "Persona_workspaceId_idImportacao_key" ON "Persona"("workspaceId", "idImportacao");

DROP INDEX "Regiao_nome_key";
DROP INDEX "Regiao_idImportacao_key";
CREATE UNIQUE INDEX "Regiao_workspaceId_nome_key" ON "Regiao"("workspaceId", "nome");
CREATE UNIQUE INDEX "Regiao_workspaceId_idImportacao_key" ON "Regiao"("workspaceId", "idImportacao");

DROP INDEX "Departamento_nome_key";
CREATE UNIQUE INDEX "Departamento_workspaceId_nome_key" ON "Departamento"("workspaceId", "nome");

-- 6) Fluxo de sistema do No Code: um por instância (antes: um no app inteiro).
DROP INDEX "NoCodeFlow_sistema_unico";
CREATE UNIQUE INDEX "NoCodeFlow_sistema_unico" ON "NoCodeFlow"("workspaceId") WHERE "sistema" = true;

-- 7) Tabelas de linha única: passam a ter uma linha por instância (a linha atual vira a da principal).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Settings', 'InboundWebhookToken', 'BackupConfig'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN "workspaceId" TEXT', t);
    EXECUTE format('UPDATE %I SET "workspaceId" = ''ws_principal''', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "workspaceId" SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "id" DROP DEFAULT', t);
    EXECUTE format('CREATE UNIQUE INDEX %I ON %I ("workspaceId")', t || '_workspaceId_key', t);
  END LOOP;
END $$;
