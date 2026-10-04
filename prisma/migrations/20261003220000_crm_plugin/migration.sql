-- Plugin CRM: departamentos, atendentes e transferência de conversas do chat.
ALTER TABLE "Settings" ADD COLUMN "crmPluginAtivo" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "Departamento" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Departamento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Atendente" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Atendente_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AtendenteDepartamento" (
    "atendenteId" TEXT NOT NULL,
    "departamentoId" TEXT NOT NULL,

    CONSTRAINT "AtendenteDepartamento_pkey" PRIMARY KEY ("atendenteId","departamentoId")
);

CREATE TABLE "LeadAtendimento" (
    "leadId" TEXT NOT NULL,
    "departamentoId" TEXT,
    "atendenteId" TEXT,
    "transferidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadAtendimento_pkey" PRIMARY KEY ("leadId")
);

CREATE TABLE "AtendimentoTransferencia" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "deDepartamento" TEXT,
    "paraDepartamento" TEXT,
    "deAtendente" TEXT,
    "paraAtendente" TEXT,
    "porUsuario" TEXT NOT NULL,
    "motivo" TEXT,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AtendimentoTransferencia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Departamento_nome_key" ON "Departamento"("nome");
CREATE INDEX "Departamento_ativo_nome_idx" ON "Departamento"("ativo", "nome");
CREATE UNIQUE INDEX "Atendente_userId_key" ON "Atendente"("userId");
CREATE INDEX "Atendente_ativo_idx" ON "Atendente"("ativo");
CREATE INDEX "AtendenteDepartamento_departamentoId_idx" ON "AtendenteDepartamento"("departamentoId");
CREATE INDEX "LeadAtendimento_departamentoId_idx" ON "LeadAtendimento"("departamentoId");
CREATE INDEX "LeadAtendimento_atendenteId_idx" ON "LeadAtendimento"("atendenteId");
CREATE INDEX "AtendimentoTransferencia_leadId_data_idx" ON "AtendimentoTransferencia"("leadId", "data");

ALTER TABLE "Atendente" ADD CONSTRAINT "Atendente_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AtendenteDepartamento" ADD CONSTRAINT "AtendenteDepartamento_atendenteId_fkey" FOREIGN KEY ("atendenteId") REFERENCES "Atendente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AtendenteDepartamento" ADD CONSTRAINT "AtendenteDepartamento_departamentoId_fkey" FOREIGN KEY ("departamentoId") REFERENCES "Departamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadAtendimento" ADD CONSTRAINT "LeadAtendimento_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadAtendimento" ADD CONSTRAINT "LeadAtendimento_departamentoId_fkey" FOREIGN KEY ("departamentoId") REFERENCES "Departamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadAtendimento" ADD CONSTRAINT "LeadAtendimento_atendenteId_fkey" FOREIGN KEY ("atendenteId") REFERENCES "Atendente"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AtendimentoTransferencia" ADD CONSTRAINT "AtendimentoTransferencia_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
