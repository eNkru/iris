#!/bin/sh
set -eu

mkdir -p /app/data

echo "[iris] applying SQLite migrations"
pnpm db:migrate

echo "[iris] starting web server and scheduler"
exec node apps/web/dist-server/server.cjs
