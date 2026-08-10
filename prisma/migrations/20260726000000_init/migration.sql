-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('novo', 'em_campanha', 'respondeu', 'qualificado', 'encerrado');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('ativa', 'pausada', 'encerrada', 'rascunho');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('mensagem_enviada', 'falha', 'resposta', 'qualificado', 'campanha_iniciada', 'campanha_encerrada');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "persona" TEXT NOT NULL,
    "regiao" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'novo',
    "campanhaId" TEXT,
    "entradaCampanhaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'rascunho',
    "recorrenciaDias" INTEGER NOT NULL DEFAULT 7,
    "dataFinal" TIMESTAMP(3),
    "filtroProduto" TEXT,
    "filtroMarca" TEXT,
    "filtroPersona" TEXT,
    "filtroRegiao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMessage" (
    "id" TEXT NOT NULL,
    "dia" INTEGER NOT NULL,
    "horario" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "campanhaId" TEXT NOT NULL,

    CONSTRAINT "CampaignMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "remetente" TEXT NOT NULL DEFAULT 'Engine Follow-up',
    "numero" TEXT NOT NULL DEFAULT '',
    "assinatura" TEXT NOT NULL DEFAULT '',
    "fuso" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "janelaInicio" TEXT NOT NULL DEFAULT '09:00',
    "janelaFim" TEXT NOT NULL DEFAULT '20:00',
    "limiteDiario" INTEGER NOT NULL DEFAULT 300,
    "respeitarJanela" BOOLEAN NOT NULL DEFAULT true,
    "pausarNoFimDeSemana" BOOLEAN NOT NULL DEFAULT true,
    "notificarFalhas" BOOLEAN NOT NULL DEFAULT true,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "tipo" "EventType" NOT NULL,
    "descricao" TEXT NOT NULL,
    "detalhes" TEXT,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sucesso" BOOLEAN NOT NULL DEFAULT true,
    "leadId" TEXT NOT NULL,
    "campanhaId" TEXT,
    "mensagemId" TEXT,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_campanhaId_idx" ON "Lead"("campanhaId");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_criadoEm_idx" ON "Lead"("criadoEm");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Campaign_criadoEm_idx" ON "Campaign"("criadoEm");

-- CreateIndex
CREATE INDEX "CampaignMessage_campanhaId_dia_idx" ON "CampaignMessage"("campanhaId", "dia");

-- CreateIndex
CREATE INDEX "TimelineEvent_data_idx" ON "TimelineEvent"("data");

-- CreateIndex
CREATE INDEX "TimelineEvent_tipo_data_idx" ON "TimelineEvent"("tipo", "data");

-- CreateIndex
CREATE INDEX "TimelineEvent_leadId_data_idx" ON "TimelineEvent"("leadId", "data");

-- CreateIndex
CREATE INDEX "TimelineEvent_campanhaId_idx" ON "TimelineEvent"("campanhaId");

-- CreateIndex
CREATE INDEX "TimelineEvent_mensagemId_idx" ON "TimelineEvent"("mensagemId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMessage" ADD CONSTRAINT "CampaignMessage_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_mensagemId_fkey" FOREIGN KEY ("mensagemId") REFERENCES "CampaignMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
