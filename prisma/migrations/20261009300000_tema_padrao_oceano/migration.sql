-- O tema padrão do painel passa a ser "oceano". Só muda o padrão de quem ainda não tem tema:
-- usuários e configurações que já existem mantêm o tema que têm hoje.
ALTER TABLE "Settings" ALTER COLUMN "temaApp" SET DEFAULT 'oceano';
ALTER TABLE "User" ALTER COLUMN "temaApp" SET DEFAULT 'oceano';
