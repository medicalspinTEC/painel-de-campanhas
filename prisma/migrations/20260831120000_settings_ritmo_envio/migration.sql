-- Novas preferências de ritmo de envio na tabela de linha única "Settings".
ALTER TABLE "Settings"
  ADD COLUMN "maxEnviosPorPeriodo" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "periodoEsperaValor" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "periodoEsperaUnidade" TEXT NOT NULL DEFAULT 'horas';
