# Build context is the repo root (pnpm workspace).
FROM node:22-alpine AS base
RUN apk add --no-cache openssh-client rsync && npm install -g pnpm@10
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter api

FROM deps AS build
COPY apps/api apps/api
COPY apps/web/prisma apps/web/prisma
# apps/api/prisma/schema.prisma is a symlink to the web app's schema (one schema, two clients)
RUN pnpm --filter api build

FROM base AS run
ENV NODE_ENV=production PORT=4000
COPY --from=build --chown=node:node /app /app
USER node
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/index.js"]
