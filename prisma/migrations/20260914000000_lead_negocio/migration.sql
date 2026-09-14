-- Identificador do negócio (ex.: CRM externo) associado ao lead. Opcional,
-- preenchido manualmente no cadastro.
ALTER TABLE "Lead" ADD COLUMN "negocio" TEXT;
