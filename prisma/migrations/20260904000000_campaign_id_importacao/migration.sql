-- ID de importação sequencial e imutável para cada campanha. Gerado
-- automaticamente a partir de 1; o usuário não edita. Permite que a planilha
-- traga este número na coluna "campanha" em vez do nome exato, evitando que a
-- equipe precise digitar o nome de cada campanha na importação de leads.
--
-- SERIAL cria a sequência e preenche as campanhas já existentes com valores
-- sequenciais (1, 2, 3, ...) na ordem atual das linhas.

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "idImportacao" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_idImportacao_key" ON "Campaign"("idImportacao");
