ALTER TABLE "Settings" ADD COLUMN "nocodePluginAtivo" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "NoCodeFlow" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "nodes" JSONB NOT NULL DEFAULT '[]',
    "edges" JSONB NOT NULL DEFAULT '[]',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoCodeFlow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NoCodeExecution" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'webhook',
    "entrada" JSONB,
    "passos" JSONB NOT NULL DEFAULT '[]',
    "erro" TEXT,
    "duracaoMs" INTEGER NOT NULL DEFAULT 0,
    "iniciadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoCodeExecution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NoCodeFlow_atualizadoEm_idx" ON "NoCodeFlow"("atualizadoEm");
CREATE INDEX "NoCodeExecution_flowId_iniciadoEm_idx" ON "NoCodeExecution"("flowId", "iniciadoEm");
CREATE INDEX "NoCodeExecution_iniciadoEm_idx" ON "NoCodeExecution"("iniciadoEm");

ALTER TABLE "NoCodeExecution" ADD CONSTRAINT "NoCodeExecution_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "NoCodeFlow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
