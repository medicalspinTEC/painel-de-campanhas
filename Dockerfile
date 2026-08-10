# syntax=docker/dockerfile:1

##########################################################################
# Base — Node 22 (alpine) com pnpm via corepack e libs que o Prisma precisa
##########################################################################
FROM node:22-alpine AS base
# openssl/libc6-compat são exigidos pelo schema engine do Prisma no Alpine.
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable
WORKDIR /app

##########################################################################
# Deps — instala TODAS as dependências a partir do lockfile (cacheável)
##########################################################################
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Ignoramos o postinstall (prisma generate) aqui: ele roda no build, onde o
# schema já está presente.
RUN pnpm install --frozen-lockfile --ignore-scripts

##########################################################################
# Builder — gera o Prisma Client e compila o Next em modo standalone
##########################################################################
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `build` == "prisma generate && next build" (ver package.json).
RUN pnpm build

##########################################################################
# Migrator — imagem enxuta usada só para rodar `prisma migrate deploy`
##########################################################################
FROM base AS migrator
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml prisma.config.ts ./
COPY prisma ./prisma
COPY lib/generated ./lib/generated
CMD ["pnpm", "prisma", "migrate", "deploy"]

##########################################################################
# Runner — servidor Next standalone, mínimo e sem toolchain de build
##########################################################################
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Usuário não-root por segurança.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Saída standalone: servidor + node_modules mínimos + estáticos + public.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
