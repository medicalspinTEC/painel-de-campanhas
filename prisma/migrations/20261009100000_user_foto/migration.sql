-- Foto de perfil dos usuários. Os bytes ficam numa tabela própria (a imagem já vem reduzida do navegador).
ALTER TABLE "User" ADD COLUMN "fotoAtualizadaEm" TIMESTAMP(3);

CREATE TABLE "UserFoto" (
    "userId" TEXT NOT NULL,
    "dados" BYTEA NOT NULL,
    "mime" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFoto_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserFoto" ADD CONSTRAINT "UserFoto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
