/**
 * Standalone SQLite migrator — a tiny re-implementation of drizzle-kit's
 * `migrate` that needs ONLY `better-sqlite3` + Node builtins at runtime.
 *
 * Why this exists: the Docker runner image ships a single bundled
 * `server.cjs` whose only external npm dep is `better-sqlite3`. Running
 * `drizzle-kit migrate` at boot would otherwise force the image to also
 * ship pnpm + drizzle-kit + esbuild + tsx (~60 MB) just for the one-shot
 * migration step. This script does the same job with ~60 lines and zero
 * extra deps.
 *
 * Compatibility: it writes the SAME `__drizzle_migrations` table and uses the
 * SAME selection logic as drizzle-orm's SQLiteSyncDialect.migrate() (hash =
 * sha256 of the full migration file contents, created_at = the journal
 * entry's `when` millis), so `drizzle-kit migrate` / `drizzle-kit studio`
 * remain interchangeable with this script against the same database.
 *
 * Usage (bundled to CJS by the Dockerfile):
 *   node migrate.cjs <migrationsDir> <dbPath>
 *
 * If args are omitted, falls back to env: DATABASE_PATH and a default
 * migrations dir relative to the script (the Dockerfile copies the
 * migrations next to this script).
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

interface JournalEntry {
  idx: number;
  version: number;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: number;
  dialect: string;
  entries: JournalEntry[];
}

interface Migration {
  tag: string;
  sql: string[];
  bps: boolean;
  folderMillis: number;
  hash: string;
}

const MIGRATIONS_TABLE = "__drizzle_migrations";

function readMigrationFiles(migrationsFolder: string): Migration[] {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    throw new Error(`Can't find meta/_journal.json file at ${journalPath}`);
  }
  const journal: Journal = JSON.parse(
    readFileSync(journalPath, "utf8").toString(),
  );
  const migrations: Migration[] = [];
  for (const entry of journal.entries) {
    const migrationFile = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!existsSync(migrationFile)) {
      throw new Error(`No file ${migrationFile} found in ${migrationsFolder} folder`);
    }
    const query = readFileSync(migrationFile, "utf8").toString();
    // drizzle splits on the exact breakpoint marker; trailing/leading
    // whitespace around each statement is preserved by SQLite's parser.
    const statements = query.split("--> statement-breakpoint");
    migrations.push({
      tag: entry.tag,
      sql: statements,
      bps: entry.breakpoints,
      folderMillis: entry.when,
      hash: createHash("sha256").update(query).digest("hex"),
    });
  }
  return migrations;
}

function migrate(migrationsFolder: string, dbPath: string): void {
  // Resolve + create the parent dir, mirroring packages/database/src/drizzle/client.ts
  // and drizzle.config.ts, so a relative/missing dir never crashes boot.
  const resolvedDbPath = dbPath === ":memory:" ? dbPath : path.resolve(dbPath);
  if (resolvedDbPath !== ":memory:") {
    mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
  }

  const migrations = readMigrationFiles(migrationsFolder);
  const sqlite = new Database(resolvedDbPath);
  sqlite.pragma("foreign_keys = ON");

  // drizzle-orm's exact table definition (SQLiteSyncDialect.migrate).
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash text NOT NULL,
      created_at numeric
    )
  `);

  const last = sqlite
    .prepare(
      `SELECT id, hash, created_at FROM ${MIGRATIONS_TABLE} ORDER BY created_at DESC LIMIT 1`,
    )
    .get() as { id: number; hash: string; created_at: number } | undefined;

  const lastMillis = last ? Number(last.created_at) : undefined;
  const pending = migrations.filter(
    (m) => lastMillis === undefined || lastMillis < m.folderMillis,
  );

  if (pending.length === 0) {
    sqlite.close();
    console.log(
      `[iris] no pending migrations (db: ${resolvedDbPath}, latest: ${lastMillis ?? "none"})`,
    );
    return;
  }

  const apply = sqlite.transaction(() => {
    for (const migration of pending) {
      for (const stmt of migration.sql) {
        const trimmed = stmt.trim();
        if (trimmed.length > 0) {
          sqlite.exec(trimmed);
        }
      }
      sqlite
        .prepare(
          `INSERT INTO ${MIGRATIONS_TABLE} ("hash", "created_at") VALUES (?, ?)`,
        )
        .run(migration.hash, migration.folderMillis);
    }
  });
  apply();
  sqlite.close();

  console.log(
    `[iris] applied ${pending.length} migration(s): ${pending
      .map((m) => m.tag)
      .join(", ")}`,
  );
}

// --- entrypoint -------------------------------------------------------------
// Defaults resolve against the SCRIPT location (not process.cwd()), so the
// bundled CJS in the Docker image finds the migrations regardless of the
// container's working directory. `__dirname` is set by esbuild's CJS output;
// tsx provides it too.
const here = typeof __dirname !== "undefined" ? __dirname : import.meta.dirname;
const migrationsDir =
  process.argv[2] ?? path.join(here, "drizzle", "migrations");
const dbPath = process.argv[3] ?? process.env.DATABASE_PATH ?? "./data/iris.db";

if (!existsSync(migrationsDir)) {
  console.error(`[iris] migrations dir not found: ${migrationsDir}`);
  process.exit(1);
}

migrate(migrationsDir, dbPath);
