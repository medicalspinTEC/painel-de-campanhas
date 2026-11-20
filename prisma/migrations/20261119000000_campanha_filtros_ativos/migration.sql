-- Filtros de público passam a ser opcionais por campanha.
-- Campanhas existentes mantêm o comportamento atual (filtros ativos).
ALTER TABLE "Campaign" ADD COLUMN "filtrosAtivos" BOOLEAN NOT NULL DEFAULT true;
