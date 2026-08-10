-- Agenda por lead da próxima mensagem e reinício de ciclo individual,
-- usados pela ação de "pular" mensagem na página da campanha.
ALTER TABLE "LeadCampaign" ADD COLUMN "proximaMensagemEm" TIMESTAMP(3);
ALTER TABLE "LeadCampaign" ADD COLUMN "cicloReiniciadoEm" TIMESTAMP(3);
