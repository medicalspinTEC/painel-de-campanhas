-- Fluxo do sistema do plugin No Code (o "Fluxo de resposta"): sempre ativo e sem exclusão.
ALTER TABLE "NoCodeFlow" ADD COLUMN "sistema" BOOLEAN NOT NULL DEFAULT false;

-- Garante um único fluxo do sistema, mesmo com requisições simultâneas.
CREATE UNIQUE INDEX "NoCodeFlow_sistema_unico" ON "NoCodeFlow"("sistema") WHERE "sistema" = true;
