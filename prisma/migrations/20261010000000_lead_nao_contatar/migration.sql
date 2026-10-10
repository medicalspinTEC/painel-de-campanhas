-- Novo status de lead "não contatar": o lead não pode ser vinculado a campanhas,
-- mas segue conversando normalmente no chat. O valor novo do enum só pode ser
-- usado em outra migração (o Postgres não permite usá-lo na mesma transação
-- em que é criado).
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'nao_contatar';
