CREATE TYPE "ScheduledMessageStatus" AS ENUM ('pendente', 'enviada', 'falhou');

CREATE TABLE "ScheduledMessage" (
    "id" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "instanciaNome" TEXT,
    "agendadoPara" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledMessageStatus" NOT NULL DEFAULT 'pendente',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimaTentativaEm" TIMESTAMP(3),
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoEm" TIMESTAMP(3),
    "leadId" TEXT NOT NULL,

    CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ScheduledMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ScheduledMessage_status_agendadoPara_idx" ON "ScheduledMessage"("status", "agendadoPara");
CREATE INDEX "ScheduledMessage_leadId_agendadoPara_idx" ON "ScheduledMessage"("leadId", "agendadoPara");