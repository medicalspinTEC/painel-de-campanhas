-- Plugin de chat: etiquetas (tags) nas conversas, também usadas como filtro da lista.
CREATE TABLE "ChatTag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cor" TEXT NOT NULL DEFAULT 'azul',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatTagLead" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatTagLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatTag_workspaceId_idx" ON "ChatTag"("workspaceId");
CREATE UNIQUE INDEX "ChatTag_workspaceId_nome_key" ON "ChatTag"("workspaceId", "nome");
CREATE INDEX "ChatTagLead_leadId_idx" ON "ChatTagLead"("leadId");
CREATE UNIQUE INDEX "ChatTagLead_tagId_leadId_key" ON "ChatTagLead"("tagId", "leadId");

ALTER TABLE "ChatTagLead" ADD CONSTRAINT "ChatTagLead_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "ChatTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatTagLead" ADD CONSTRAINT "ChatTagLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
