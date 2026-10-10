-- Notificações push (PWA): aparelhos inscritos e notificações criadas pelo Root.
CREATE TABLE "PushAssinatura" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "plataforma" TEXT NOT NULL DEFAULT 'desktop',
    "instalado" BOOLEAN NOT NULL DEFAULT false,
    "falhas" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "ultimoEnvioEm" TIMESTAMP(3),

    CONSTRAINT "PushAssinatura_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PushNotificacao" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '/',
    "imagem" TEXT,
    "urgente" BOOLEAN NOT NULL DEFAULT false,
    "publico" TEXT NOT NULL DEFAULT 'todos',
    "papeis" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "usuarioIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "somenteInstalados" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'rascunho',
    "agendadaPara" TIMESTAMP(3),
    "enviadaEm" TIMESTAMP(3),
    "totalAlvos" INTEGER NOT NULL DEFAULT 0,
    "enviados" INTEGER NOT NULL DEFAULT 0,
    "falhas" INTEGER NOT NULL DEFAULT 0,
    "removidos" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "criadoPorId" TEXT,
    "criadoPorNome" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "ultimaVarreduraEm" TIMESTAMP(3),

    CONSTRAINT "PushNotificacao_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushAssinatura_endpoint_key" ON "PushAssinatura"("endpoint");
CREATE INDEX "PushAssinatura_userId_idx" ON "PushAssinatura"("userId");
CREATE INDEX "PushNotificacao_status_agendadaPara_idx" ON "PushNotificacao"("status", "agendadaPara");
CREATE INDEX "PushNotificacao_criadoEm_idx" ON "PushNotificacao"("criadoEm");

ALTER TABLE "PushAssinatura" ADD CONSTRAINT "PushAssinatura_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
