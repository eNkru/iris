# syntax=docker/dockerfile:1
# Iris all-in-one image: Hono server + Vite SPA + scheduler — a single Node
# process. Anti-detect page fetching runs in the external argus service
# (deployed from the argus repo); iris calls it over HTTP with bearer auth.
#
# Multi-stage build:
#   - builder: installs build toolchain (build-essential/python3 for
#     better-sqlite3's node-gyp) and builds the SPA + esbuild server bundle.
#   - runner: slim runtime with no compilers; runs as the non-root `node` user.

# -----------------------------------------------------------------------------
# Stage 1: builder
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive

# build-essential + python3 are needed by better-sqlite3's node-gyp build
# during `pnpm install`. ca-certificates for TLS.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        python3 \
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
# The ARGUS_BASE_URL build-time default is a non-secret convenience only;
# ARGUS_API_TOKEN is a runtime secret supplied via compose `environment:` (or
# `docker run -e`) and is intentionally NOT baked into an image layer. A
# missing runtime token fails env validation fast at boot instead of
# surfacing as a confusing argus 401 deep in the pipeline.
ARG DATABASE_PATH=/app/data/iris.db
ARG ARGUS_BASE_URL=http://localhost:8000
ENV DATABASE_PATH=${DATABASE_PATH}
ENV ARGUS_BASE_URL=${ARGUS_BASE_URL}
ENV NODE_ENV=production

RUN pnpm --filter @iris/web build \
    && pnpm --filter @iris/web server:build \
    && rm -rf /root/.cache/pnpm \
    && rm -rf /app/data

# -----------------------------------------------------------------------------
# Stage 2: runner (no compilers, non-root)
# -----------------------------------------------------------------------------
FROM node:22-slim AS runner

ENV DEBIAN_FRONTEND=noninteractive

# Runtime apt deps only: ca-certificates for TLS, wget for the healthcheck.
# No build-essential / python3 — the final image carries no compilers.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        wget \
    && rm -rf /var/lib/apt/lists/*

# pnpm is needed at runtime for `pnpm db:migrate` in the entrypoint. Copy the
# corepack-installed pnpm from the builder so the runner doesn't download it
# at boot (offline-friendly, deterministic).
COPY --from=builder /usr/local/lib/node_modules/corepack /usr/local/lib/node_modules/corepack
COPY --from=builder /usr/local/bin/corepack /usr/local/bin/corepack
RUN corepack enable

WORKDIR /app

# Copy the built application + its node_modules (including the better-sqlite3
# native build and pnpm's virtual-store symlinks) from the builder. Copying
# the whole /app preserves the pnpm symlink layout Vite/esbuild rely on.
COPY --from=builder /app /app

# The SQLite database lives under /app/data; ensure the non-root `node` user
# (uid 1000, shipped by the node base image) can write it.
RUN mkdir -p /app/data && chown -R node:node /app

COPY docker-entrypoint.sh /usr/local/bin/iris-app-start
RUN chmod +x /usr/local/bin/iris-app-start

# Drop privileges — run as the non-root `node` user.
USER node

VOLUME ["/app/data"]
EXPOSE 3000

CMD ["/usr/local/bin/iris-app-start"]
