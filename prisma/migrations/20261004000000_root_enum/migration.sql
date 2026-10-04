-- Nível Root (acima do admin). O valor novo do enum só pode ser usado em outra
-- migração (o Postgres não permite usá-lo na mesma transação em que é criado).
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'root';
