# Build context is the repo root (pnpm workspace).
FROM node:22-alpine AS base
# APP_UID must match the owner of the bind-mounted repo (ladm on vps-01v) so "apply results" can write and commit mods.json.
ARG APP_UID=1009
RUN apk upgrade --no-cache && apk add --no-cache libc6-compat openssl git && npm install -g pnpm@10 \
 && deluser node && addgroup -g ${APP_UID} app && adduser -D -u ${APP_UID} -G app app
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/modpack/package.json packages/modpack/
RUN pnpm install --frozen-lockfile --filter web --filter modpack

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

FROM base AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 MODPACK_DIR=/repo/modpack REPO_DIR=/repo
COPY --from=build --chown=app:app /app /app
USER app
EXPOSE 3000
# Migrations run on every start (idempotent), then the app.
# Stamped by CI (planner, 2026-10-01): the footer shows what is really running, never a typed number.
ARG GIT_SHA=dev
ARG BUILT_AT=
ENV PORTAL_COMMIT=$GIT_SHA PORTAL_BUILT_AT=$BUILT_AT
CMD ["sh", "-c", "pnpm --filter web exec prisma migrate deploy && pnpm --filter web start"]
