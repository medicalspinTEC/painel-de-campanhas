-- Marca o último (re)início da campanha para permitir reenvio ao reiniciar.
ALTER TABLE "Campaign" ADD COLUMN "reiniciadaEm" TIMESTAMP(3);
