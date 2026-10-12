-- Plugin CRM: CNPJ do lead e a última consulta feita na Receita (ReceitaWS).
ALTER TABLE "Lead" ADD COLUMN "cnpj" TEXT,
ADD COLUMN "cnpjDados" JSONB,
ADD COLUMN "cnpjConsultadoEm" TIMESTAMP(3);
