-- Pastas para organizar campanhas.
CREATE TABLE "CampaignPasta" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignPasta_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Campaign" ADD COLUMN "pastaId" TEXT;

CREATE INDEX "CampaignPasta_workspaceId_idx" ON "CampaignPasta"("workspaceId");
CREATE UNIQUE INDEX "CampaignPasta_workspaceId_nome_key" ON "CampaignPasta"("workspaceId", "nome");
CREATE INDEX "Campaign_pastaId_idx" ON "Campaign"("pastaId");

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_pastaId_fkey" FOREIGN KEY ("pastaId") REFERENCES "CampaignPasta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
