# syntax=docker/dockerfile:1

# ================= BASE =================
FROM node:22-alpine AS base

RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# ================= DEPS =================
FROM base AS deps

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY prisma ./prisma/

# --ignore-scripts: o postinstall (prisma generate) roda no builder, onde
# o schema completo e a saída lib/generated já estão disponíveis.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ================= BUILDER =================
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# DATABASE_URL de placeholder para o build. O Prisma 7 usa o driver adapter
# (@prisma/adapter-pg), então "prisma generate" e o "next build" não abrem
# conexão real com o banco — o valor real é injetado em runtime.
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db?schema=public"
ENV NEXT_TELEMETRY_DISABLED=1

# "build" == "prisma generate && next build" (ver package.json).
RUN pnpm run build

# ================= MIGRATOR =================
# Imagem enxuta usada apenas para aplicar as migrations.
FROM base AS migrator

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml* prisma.config.ts ./
COPY prisma ./prisma/
COPY lib/generated ./lib/generated/

CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ================= RUNNER =================
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Saída standalone do Next: servidor autocontido + assets estáticos + public.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
