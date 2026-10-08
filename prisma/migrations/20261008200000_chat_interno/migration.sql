-- Chat interno (equipe): conversas entre usuários do painel. Anexos NÃO ficam no banco.
CREATE TABLE "InternoConversa" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'direta',
    "nome" TEXT,
    "chaveDireta" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaMensagemEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternoConversa_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InternoParticipante" (
    "conversaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ultimaLeituraEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entrouEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternoParticipante_pkey" PRIMARY KEY ("conversaId","userId")
);

CREATE TABLE "InternoMensagem" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "autorId" TEXT NOT NULL,
    "texto" TEXT NOT NULL DEFAULT '',
    "anexoId" TEXT,
    "anexoTipo" TEXT,
    "anexoMime" TEXT,
    "anexoTamanho" INTEGER,
    "anexoNome" TEXT,
    "baixadoPor" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternoMensagem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InternoConversa_workspaceId_chaveDireta_key" ON "InternoConversa"("workspaceId", "chaveDireta");
CREATE INDEX "InternoConversa_workspaceId_ultimaMensagemEm_idx" ON "InternoConversa"("workspaceId", "ultimaMensagemEm");
CREATE INDEX "InternoParticipante_userId_idx" ON "InternoParticipante"("userId");
CREATE INDEX "InternoMensagem_conversaId_criadoEm_idx" ON "InternoMensagem"("conversaId", "criadoEm");
CREATE INDEX "InternoMensagem_anexoId_idx" ON "InternoMensagem"("anexoId");

ALTER TABLE "InternoParticipante" ADD CONSTRAINT "InternoParticipante_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "InternoConversa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternoParticipante" ADD CONSTRAINT "InternoParticipante_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternoMensagem" ADD CONSTRAINT "InternoMensagem_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "InternoConversa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternoMensagem" ADD CONSTRAINT "InternoMensagem_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
