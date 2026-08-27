# syntax=docker/dockerfile:1
# Iris all-in-one image: Hono server + Vite SPA + scheduler — a single Node
# process. Anti-detect page fetching runs in the external argus service
# (deployed from the argus repo); iris calls it over HTTP with bearer auth.
#
# Multi-stage build:
#   - builder: installs build toolchain (build-essential/python3 for
#     better-sqlite3's node-gyp) and builds the SPA, the esbuild server
#     bundle, and the standalone migrate.cjs.
#   - runner: slim runtime carrying ONLY the SPA, the two bundled CJS
#     bundles, the drizzle migration .sql files, and the better-sqlite3
#     native addon (+ its tiny `bindings`/`file-uri-to-path` loaders). No
#     pnpm, drizzle-kit, esbuild, tsx, typescript, or dev deps. Runs as the
#     non-root `node` user.

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

# Bundle the standalone migrator (packages/database/src/migrate.ts) to a CJS
# file. The runner needs only better-sqlite3 (externalized) + Node builtins,
# so this avoids shipping drizzle-kit/esbuild/tsx just to run migrations.
# esbuild is a devDep of @iris/database (see db:migrate:build script).
RUN pnpm --filter @iris/database db:migrate:build

# -----------------------------------------------------------------------------
# Stage 2: runner (no compilers, non-root, minimal)
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

WORKDIR /app

# --- The runner ships ONLY these artifacts (see the size budget below). ---
# Copy the SPA and the bundled server + migrator. Both CJS bundles were built
# with `--external:better-sqlite3`, so the sole npm package either needs at
# runtime is better-sqlite3 (native addon) + its tiny `bindings` loader.
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/apps/web/dist-server/server.cjs ./apps/web/dist-server/server.cjs
COPY --from=builder /app/packages/database/dist/migrate.cjs ./packages/database/dist/migrate.cjs
COPY --from=builder /app/packages/database/drizzle/migrations ./packages/database/drizzle/migrations

# better-sqlite3 native addon + its JS wrapper, plus `bindings` and
# `file-uri-to-path` (the `bindings` loader resolves `build/Release/*.node`
# relative to the better-sqlite3 package dir). Preserve the real package
# dirs (resolved through the pnpm virtual store) under /app/node_modules so
# Node's require("better-sqlite3") / require("bindings") resolve cleanly.
COPY --from=builder /app/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/.pnpm/bindings@*/node_modules/bindings ./node_modules/bindings
COPY --from=builder /app/node_modules/.pnpm/file-uri-to-path@*/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# The SQLite database lives under /app/data; ensure the non-root `node` user
# (uid 1000, shipped by the node base image) can write it. Only /app/data
# needs the chown — not the whole tree (the app files are read-only).
RUN mkdir -p /app/data && chown -R node:node /app/data

COPY docker-entrypoint.sh /usr/local/bin/iris-app-start
RUN chmod +x /usr/local/bin/iris-app-start

# Drop privileges — run as the non-root `node` user.
USER node

VOLUME ["/app/data"]
EXPOSE 3000

CMD ["/usr/local/bin/iris-app-start"]
