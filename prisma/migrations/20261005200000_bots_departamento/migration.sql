-- Bots de departamento: fluxos No Code do tipo "bot" que respondem conversas do chat.
ALTER TABLE "NoCodeFlow" ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'automacao';
ALTER TABLE "NoCodeFlow" ADD COLUMN "botEntrada" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NoCodeFlow" ADD COLUMN "departamentoId" TEXT;

ALTER TABLE "NoCodeFlow"
  ADD CONSTRAINT "NoCodeFlow_departamentoId_fkey"
  FOREIGN KEY ("departamentoId") REFERENCES "Departamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "NoCodeFlow_departamentoId_idx" ON "NoCodeFlow"("departamentoId");

-- Estado do bot em cada conversa (pausa quando um humano assume).
CREATE TABLE "BotConversa" (
    "leadId" TEXT NOT NULL,
    "botAtivo" BOOLEAN NOT NULL DEFAULT true,
    "pausadoMotivo" TEXT,
    "pausadoEm" TIMESTAMP(3),
    "flowId" TEXT,
    "aguardandoNoId" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimaInteracaoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotConversa_pkey" PRIMARY KEY ("leadId")
);

CREATE INDEX "BotConversa_flowId_idx" ON "BotConversa"("flowId");

ALTER TABLE "BotConversa"
  ADD CONSTRAINT "BotConversa_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BotConversa"
  ADD CONSTRAINT "BotConversa_flowId_fkey"
  FOREIGN KEY ("flowId") REFERENCES "NoCodeFlow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
