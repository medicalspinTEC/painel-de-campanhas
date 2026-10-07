-- Bot especialista em follow-up por departamento: templates e ajustes por conversa.
CREATE TABLE "FollowUpBot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "departamentoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "ativadoEm" TIMESTAMP(3),
    "minutosSemResposta" INTEGER NOT NULL DEFAULT 60,
    "maxFollowUps" INTEGER NOT NULL DEFAULT 1,
    "modoTemplate" TEXT NOT NULL DEFAULT 'aleatorio',
    "templateFixoId" TEXT,
    "janelaAtiva" BOOLEAN NOT NULL DEFAULT false,
    "janelaInicio" INTEGER NOT NULL DEFAULT 8,
    "janelaFim" INTEGER NOT NULL DEFAULT 20,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpBot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FollowUpBot_departamentoId_key" ON "FollowUpBot"("departamentoId");
CREATE INDEX "FollowUpBot_workspaceId_idx" ON "FollowUpBot"("workspaceId");

ALTER TABLE "FollowUpBot"
  ADD CONSTRAINT "FollowUpBot_departamentoId_fkey"
  FOREIGN KEY ("departamentoId") REFERENCES "Departamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FollowUpTemplate" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FollowUpTemplate_botId_idx" ON "FollowUpTemplate"("botId");

ALTER TABLE "FollowUpTemplate"
  ADD CONSTRAINT "FollowUpTemplate_botId_fkey"
  FOREIGN KEY ("botId") REFERENCES "FollowUpBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FollowUpConversa" (
    "leadId" TEXT NOT NULL,
    "desativado" BOOLEAN NOT NULL DEFAULT false,
    "templateId" TEXT,
    "enviados" INTEGER NOT NULL DEFAULT 0,
    "ultimoEnvioEm" TIMESTAMP(3),
    "ultimoTemplateId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpConversa_pkey" PRIMARY KEY ("leadId")
);

CREATE INDEX "FollowUpConversa_templateId_idx" ON "FollowUpConversa"("templateId");

ALTER TABLE "FollowUpConversa"
  ADD CONSTRAINT "FollowUpConversa_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FollowUpConversa"
  ADD CONSTRAINT "FollowUpConversa_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "FollowUpTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
