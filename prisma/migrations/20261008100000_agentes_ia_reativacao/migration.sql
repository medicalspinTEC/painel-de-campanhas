-- Agentes de IA: reativação automática opcional (minutos sem atividade da equipe). Nulo = desligada.
ALTER TABLE "AgenteIA" ADD COLUMN "reativarAposMinutos" INTEGER;
