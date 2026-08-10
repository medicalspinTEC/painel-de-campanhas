-- CreateTable
CREATE TABLE "InboundWebhookToken" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "token" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoUsoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundWebhookToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEvent" (
    "id" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "origem" TEXT,
    "payload" JSONB NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboundEvent_recebidoEm_idx" ON "InboundEvent"("recebidoEm");

-- CreateIndex
CREATE INDEX "InboundEvent_evento_recebidoEm_idx" ON "InboundEvent"("evento", "recebidoEm");
