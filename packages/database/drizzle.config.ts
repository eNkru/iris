import { config as loadDotenv } from "dotenv";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs from packages/database; load the repo-root `.env` so
// DATABASE_PATH is available to `migrate`/`studio` (generate is offline).
// dotenv does NOT override existing process.env by default, so a value set
// by the shell/compose always wins over the `.env` file.
loadDotenv({ path: path.resolve(process.cwd(), "../../.env") });

// Resolve the database URL the same way the runtime client does. drizzle-kit
// runs with cwd = packages/database, so a RELATIVE DATABASE_PATH
// (e.g. the `.env.example` default `./data/iris.db`) would resolve to
// packages/database/data/iris.db — a directory that does not exist — and
// better-sqlite3 throws "Cannot open database because the directory does not
// exist". Resolve to absolute and create the parent directory so `migrate`
// works from any cwd with any path (relative or absolute), matching the
// runtime behaviour in packages/database/src/drizzle/client.ts.
const rawDbUrl = process.env.DATABASE_PATH ?? "./data/iris.db";
const dbUrl = rawDbUrl === ":memory:" ? rawDbUrl : path.resolve(rawDbUrl);
if (dbUrl !== ":memory:") {
  mkdirSync(path.dirname(dbUrl), { recursive: true });
}

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/drizzle/schema/index.ts",
  out: "./drizzle/migrations",
  dbCredentials: {
    url: dbUrl,
  },
  strict: true,
  verbose: true,
});
