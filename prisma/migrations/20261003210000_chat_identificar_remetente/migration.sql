-- Preferência pessoal do chat: identificar o remetente (nome do usuário) nas mensagens ao lead.
ALTER TABLE "User" ADD COLUMN "chatIdentificarRemetente" BOOLEAN NOT NULL DEFAULT false;
