-- Root controla os admins: cada admin passa a ter seções e poderes definidos pelo root.
ALTER TABLE "User" ADD COLUMN "poderes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- 1) O admin mais antigo (o primeiro criado) vira Root, para que já exista
--    alguém com controle total. Troque depois em Usuários, se quiser.
UPDATE "User"
SET "role" = 'root', "secoes" = ARRAY[]::TEXT[], "poderes" = ARRAY[]::TEXT[]
WHERE "id" = (
  SELECT "id" FROM "User" WHERE "role" = 'admin' ORDER BY "criadoEm" ASC, "id" ASC LIMIT 1
);

-- 2) Os demais admins mantêm exatamente o acesso que já tinham (tudo): o Root
--    pode reduzir depois, admin por admin.
UPDATE "User"
SET
  "secoes" = ARRAY['dashboard','leads','kanban','chat','assistente','nocode','campanhas','segmentacao','eventos','logs','relatorios','instancias','integracoes','configuracoes'],
  "poderes" = ARRAY['usuarios_criar','usuarios_editar','usuarios_secoes','usuarios_excluir','crm_gerenciar','rotas_secretas']
WHERE "role" = 'admin';
