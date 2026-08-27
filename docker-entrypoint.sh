#!/bin/sh
set -eu

# Resolve the database directory the same way the server and migrator do, so a
# relative DATABASE_PATH still boots. The migrator also mkdirs the parent dir
# itself; this is a belt-and-suspenders no-op for the default absolute path.
DB_PATH="${DATABASE_PATH:-/app/data/iris.db}"
case "$DB_PATH" in
  :memory:) ;;
  /*) mkdir -p "$(dirname "$DB_PATH")" ;;
  *)  mkdir -p "/app/$(dirname "$DB_PATH")" ;;
esac

echo "[iris] applying SQLite migrations"
node /app/packages/database/dist/migrate.cjs /app/packages/database/drizzle/migrations "$DB_PATH"

echo "[iris] starting web server and scheduler"
exec node /app/apps/web/dist-server/server.cjs
