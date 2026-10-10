# Notificações push (PWA) — como aplicar

Copie os arquivos deste pacote por cima do projeto (mesmas pastas). Depois:

1. `pnpm install` (ou `npm install`) — entra a dependência `web-push` (+ `@types/web-push`).
2. `pnpm exec prisma migrate deploy` e `pnpm exec prisma generate` — cria as tabelas
   `PushAssinatura` e `PushNotificacao` (migration `20261010200000_push_notificacoes`).
3. Gere as chaves VAPID e cadastre no ambiente do servidor, depois reinicie o app:

   ```
   npx web-push generate-vapid-keys
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=mailto:seu-email@suaempresa.com
   ```
   (Também dá para gerar o par na própria tela /push, enquanto ainda não está configurado.)
4. Faça o deploy (as notificações só funcionam em produção, com HTTPS).

Uso: entre como Root → menu Sistema → "Notificações push".
