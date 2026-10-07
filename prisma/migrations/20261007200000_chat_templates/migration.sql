-- Chat: templates de mensagem pessoais (atalho "/nome"), até 10 por usuário.
CREATE TABLE "ChatTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatTemplate_userId_nome_key" ON "ChatTemplate"("userId", "nome");

ALTER TABLE "ChatTemplate"
  ADD CONSTRAINT "ChatTemplate_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
