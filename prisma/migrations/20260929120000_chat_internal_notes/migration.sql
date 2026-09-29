CREATE TABLE "ChatInternalNote" (
    "id" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leadId" TEXT NOT NULL,

    CONSTRAINT "ChatInternalNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatInternalNote_leadId_data_idx" ON "ChatInternalNote"("leadId", "data");

ALTER TABLE "ChatInternalNote"
ADD CONSTRAINT "ChatInternalNote_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;