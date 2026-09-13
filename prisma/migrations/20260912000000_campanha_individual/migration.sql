-- Tipo de campanha: sequência padrão para todos ou mensagem individual por lead.
CREATE TYPE "CampaignTipo" AS ENUM ('padrao', 'individual');

ALTER TABLE "Campaign" ADD COLUMN "tipo" "CampaignTipo" NOT NULL DEFAULT 'padrao';

-- Texto individual por lead e momento do disparo único (campanhas `individual`).
ALTER TABLE "LeadCampaign" ADD COLUMN "mensagemIndividual" TEXT;
ALTER TABLE "LeadCampaign" ADD COLUMN "enviadaIndividualEm" TIMESTAMP(3);
