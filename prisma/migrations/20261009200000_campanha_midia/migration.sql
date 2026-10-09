-- Anexo (imagem/arquivo) nas mensagens de campanha. Só a referência fica no banco; o arquivo fica numa pasta do servidor.
ALTER TABLE "CampaignMessage" ADD COLUMN IF NOT EXISTS "midia" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "midia" TEXT;
