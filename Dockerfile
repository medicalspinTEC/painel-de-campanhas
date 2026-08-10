# ================= BASE =================
FROM node:22-alpine AS base

RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# ================= DEPS =================
FROM base AS deps

COPY package.json pnpm-lock.yaml* ./
COPY prisma ./prisma/

RUN npm install --legacy-peer-deps --frozen-lockfile

# ================= BUILDER =================
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 🔥 NECESSÁRIO PARA PRISMA DURANTE BUILD
ENV DATABASE_URL="postgresql://campaignsUser:jh3tMYngZ5@5.78.203.244:5434/campaignsdb"

ENV NEXT_TELEMETRY_DISABLED=1

RUN npx prisma generate
RUN npm run build

# ================= RUNNER =================
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]