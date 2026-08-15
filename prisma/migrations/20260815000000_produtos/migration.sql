-- Catálogo de produtos gerenciado na página de Segmentação.
-- Os leads continuam guardando o produto como texto (o nome); esta tabela é
-- apenas a lista canônica de opções selecionáveis.
CREATE TABLE "Produto" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Produto_nome_key" ON "Produto"("nome");

-- CreateIndex
CREATE INDEX "Produto_ativo_nome_idx" ON "Produto"("ativo", "nome");
