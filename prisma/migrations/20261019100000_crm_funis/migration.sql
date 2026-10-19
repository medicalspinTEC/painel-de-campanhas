-- Plugin CRM: funis de vendas.
CREATE TYPE "FunilEtapaTipo" AS ENUM ('aberta', 'ganho', 'perdido');

CREATE TABLE "Funil" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Funil_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FunilEtapa" (
    "id" TEXT NOT NULL,
    "funilId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cor" TEXT NOT NULL DEFAULT 'azul',
    "tipo" "FunilEtapaTipo" NOT NULL DEFAULT 'aberta',
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunilEtapa_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadFunil" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "funilId" TEXT NOT NULL,
    "etapaId" TEXT NOT NULL,
    "valor" DOUBLE PRECISION,
    "movidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadFunil_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadFunilMovimento" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "funil" TEXT NOT NULL,
    "deEtapa" TEXT,
    "paraEtapa" TEXT,
    "porUsuario" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadFunilMovimento_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Funil_workspaceId_nome_key" ON "Funil"("workspaceId", "nome");
CREATE INDEX "Funil_workspaceId_ordem_idx" ON "Funil"("workspaceId", "ordem");
CREATE INDEX "FunilEtapa_funilId_ordem_idx" ON "FunilEtapa"("funilId", "ordem");
CREATE UNIQUE INDEX "LeadFunil_leadId_funilId_key" ON "LeadFunil"("leadId", "funilId");
CREATE INDEX "LeadFunil_funilId_etapaId_idx" ON "LeadFunil"("funilId", "etapaId");
CREATE INDEX "LeadFunil_etapaId_idx" ON "LeadFunil"("etapaId");
CREATE INDEX "LeadFunilMovimento_leadId_data_idx" ON "LeadFunilMovimento"("leadId", "data");

ALTER TABLE "FunilEtapa" ADD CONSTRAINT "FunilEtapa_funilId_fkey" FOREIGN KEY ("funilId") REFERENCES "Funil"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadFunil" ADD CONSTRAINT "LeadFunil_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadFunil" ADD CONSTRAINT "LeadFunil_funilId_fkey" FOREIGN KEY ("funilId") REFERENCES "Funil"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadFunil" ADD CONSTRAINT "LeadFunil_etapaId_fkey" FOREIGN KEY ("etapaId") REFERENCES "FunilEtapa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadFunilMovimento" ADD CONSTRAINT "LeadFunilMovimento_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
