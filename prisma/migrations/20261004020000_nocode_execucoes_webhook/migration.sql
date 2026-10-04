-- Webhook que recebe cada execução do fluxo (para guardar externamente).
ALTER TABLE "NoCodeFlow"
  ADD COLUMN "execWebhookAtivo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "execWebhookUrl" TEXT,
  ADD COLUMN "execWebhookSegredo" TEXT;

-- Estado da entrega de cada execução (com tentativas, para reenviar o que falhar).
ALTER TABLE "NoCodeExecution"
  ADD COLUMN "webhookStatus" TEXT,
  ADD COLUMN "webhookTentativas" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "webhookErro" TEXT,
  ADD COLUMN "webhookUltimaTentativaEm" TIMESTAMP(3),
  ADD COLUMN "webhookEnviadoEm" TIMESTAMP(3);

CREATE INDEX "NoCodeExecution_webhookStatus_iniciadoEm_idx" ON "NoCodeExecution"("webhookStatus", "iniciadoEm");
