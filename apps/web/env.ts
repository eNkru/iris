import { join } from "node:path";

/**
 * Load the repo-root `.env` for local dev. In Docker the env vars are set
 * directly via ENV directives / compose, so the missing-file case is a no-op.
 *
 * Imported BEFORE any `@iris/*` package in `server.ts`. ES/CJS module
 * evaluation is side-effecting, so this module's top-level load runs before
 * the `@iris/*` modules that call `getEnv()` at load time (e.g.
 * `@iris/database` resolves `DATABASE_PATH` on import).
 *
 * Uses Node's built-in `process.loadEnvFile()` (Node ≥20.12); the catch guards
 * the missing-file no-op and older runtimes.
 */
try {
  process.loadEnvFile(join(process.cwd(), "../../.env"));
} catch {
  // .env absent or process.loadEnvFile unavailable — env set by shell/compose.
}
