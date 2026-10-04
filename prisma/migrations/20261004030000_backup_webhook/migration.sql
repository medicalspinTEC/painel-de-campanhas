-- Configuração do backup para webhook externo (linha única).
CREATE TABLE "BackupConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "url" TEXT NOT NULL DEFAULT '',
    "segredo" TEXT,
    "secoes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "autoAtivo" BOOLEAN NOT NULL DEFAULT false,
    "autoModo" TEXT NOT NULL DEFAULT 'diario',
    "autoIntervaloHoras" INTEGER NOT NULL DEFAULT 24,
    "autoHorario" TEXT NOT NULL DEFAULT '03:00',
    "autoDiaSemana" INTEGER NOT NULL DEFAULT 0,
    "autoProximoEm" TIMESTAMP(3),
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupConfig_pkey" PRIMARY KEY ("id")
);

-- Histórico de backups (manuais e automáticos) e estado da entrega.
CREATE TABLE "BackupExecucao" (
    "id" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "secoes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resumo" JSONB,
    "partesEnviadas" INTEGER NOT NULL DEFAULT 0,
    "partesTotal" INTEGER NOT NULL DEFAULT 0,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "tentativas" INTEGER NOT NULL DEFAULT 1,
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaTentativaEm" TIMESTAMP(3),
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "BackupExecucao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackupExecucao_criadoEm_idx" ON "BackupExecucao"("criadoEm");
CREATE INDEX "BackupExecucao_status_ultimaTentativaEm_idx" ON "BackupExecucao"("status", "ultimaTentativaEm");
