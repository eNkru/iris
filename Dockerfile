# syntax=docker/dockerfile:1
# Iris all-in-one image: Hono server + Vite SPA + scheduler — a single Node
# process. Anti-detect page fetching runs in the external argus service
# (deployed from the argus repo); iris calls it over HTTP with bearer auth.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# build-essential + python3 are needed by better-sqlite3's node-gyp build
# during `pnpm install`. ca-certificates for TLS. wget for the healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        python3 \
        wget \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.18.0 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/prices/package.json packages/prices/package.json
COPY packages/utils/package.json packages/utils/package.json
RUN pnpm install --frozen-lockfile \
    && rm -rf /root/.local/share/pnpm /root/.cache/pnpm

# `COPY . .` supersedes /app sources; the pre-install copies above were only
# for `pnpm install`. We do NOT `rm -rf apps packages` here because that
# would also destroy the package-level node_modules symlinks pnpm created
# (e.g. packages/auth/node_modules/better-auth). Those symlinks are needed
# by Vite to resolve bare imports from workspace source files. The
# .dockerignore excludes node_modules from `COPY . .`, so the symlinks must
# survive this layer.
COPY . .

# Server-only modules validate their environment while the server builds.
# The ARGUS_* values are build-time placeholders only — the runtime values
# come from the compose environment (ARGUS_API_TOKEN is a secret and is
# never baked into an image layer).
ARG DATABASE_PATH=/app/data/iris.db
ARG ARGUS_BASE_URL=http://localhost:8000
ARG ARGUS_API_TOKEN=build-time-placeholder
ENV DATABASE_PATH=${DATABASE_PATH}
ENV ARGUS_BASE_URL=${ARGUS_BASE_URL}
ENV ARGUS_API_TOKEN=${ARGUS_API_TOKEN}
ENV NODE_ENV=production

RUN pnpm --filter @iris/web build \
    && pnpm --filter @iris/web server:build \
    && rm -rf /root/.cache/pnpm \
    && rm -rf /app/data

COPY docker-entrypoint.sh /usr/local/bin/iris-app-start
RUN chmod +x /usr/local/bin/iris-app-start

VOLUME ["/app/data"]
EXPOSE 3000

CMD ["/usr/local/bin/iris-app-start"]
