-- Tabela das instâncias de WhatsApp criadas por este painel. A listagem passa a
-- mostrar apenas as instâncias registradas aqui (e não todas as da Evolution).
CREATE TABLE "Instance" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "numero" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Instance_nome_key" ON "Instance"("nome");

CREATE INDEX "Instance_criadoEm_idx" ON "Instance"("criadoEm");
