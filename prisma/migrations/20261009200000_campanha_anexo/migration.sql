-- Anexo (imagem, vídeo ou arquivo) opcional nas mensagens da sequência de uma campanha.
-- O conteúdo fica numa pasta do servidor, não no banco: aqui há só a referência ao arquivo.
ALTER TABLE "CampaignMessage" ADD COLUMN "anexoId" TEXT;
ALTER TABLE "CampaignMessage" ADD COLUMN "anexoTipo" TEXT;
ALTER TABLE "CampaignMessage" ADD COLUMN "anexoMime" TEXT;
ALTER TABLE "CampaignMessage" ADD COLUMN "anexoNome" TEXT;
ALTER TABLE "CampaignMessage" ADD COLUMN "anexoTamanho" INTEGER;
