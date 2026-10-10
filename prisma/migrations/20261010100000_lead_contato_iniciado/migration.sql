-- Novo status de lead "contato iniciado": o próprio lead começou a conversa (plugin CRM).
-- O valor novo do enum só pode ser usado em outra migração (o Postgres não permite usá-lo
-- na mesma transação em que é criado).
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'contato_iniciado' AFTER 'novo';
