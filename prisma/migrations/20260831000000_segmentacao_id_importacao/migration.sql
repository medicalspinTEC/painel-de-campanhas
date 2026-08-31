-- ID de importação opcional para cada catálogo de segmentação. Permite que a
-- planilha traga este identificador na coluna correspondente em vez do nome
-- exato, evitando criar uma segmentação nova e sem uso durante a importação.

-- AlterTable
ALTER TABLE "Produto" ADD COLUMN "idImportacao" TEXT;

-- AlterTable
ALTER TABLE "Marca" ADD COLUMN "idImportacao" TEXT;

-- AlterTable
ALTER TABLE "Persona" ADD COLUMN "idImportacao" TEXT;

-- AlterTable
ALTER TABLE "Regiao" ADD COLUMN "idImportacao" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Produto_idImportacao_key" ON "Produto"("idImportacao");

-- CreateIndex
CREATE UNIQUE INDEX "Marca_idImportacao_key" ON "Marca"("idImportacao");

-- CreateIndex
CREATE UNIQUE INDEX "Persona_idImportacao_key" ON "Persona"("idImportacao");

-- CreateIndex
CREATE UNIQUE INDEX "Regiao_idImportacao_key" ON "Regiao"("idImportacao");
