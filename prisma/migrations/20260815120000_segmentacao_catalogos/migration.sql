-- Catálogos de segmentação gerenciados na página de Segmentação, ao lado de
-- Produto. Cada tabela é apenas a lista canônica de opções selecionáveis; os
-- leads continuam guardando marca/persona/região como texto (o nome).

-- CreateTable
CREATE TABLE "Marca" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Marca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Regiao" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Regiao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Marca_nome_key" ON "Marca"("nome");
CREATE INDEX "Marca_ativo_nome_idx" ON "Marca"("ativo", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Persona_nome_key" ON "Persona"("nome");
CREATE INDEX "Persona_ativo_nome_idx" ON "Persona"("ativo", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Regiao_nome_key" ON "Regiao"("nome");
CREATE INDEX "Regiao_ativo_nome_idx" ON "Regiao"("ativo", "nome");
