# Build context is the repo root (pnpm workspace).
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl && npm install -g pnpm@10
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

FROM base AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
# Migrations run on every start (idempotent), then the app.
CMD ["sh", "-c", "pnpm --filter web exec prisma migrate deploy && pnpm --filter web start"]
