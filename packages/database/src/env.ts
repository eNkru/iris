import path from "node:path";

// Load the repo-root `.env` before any module that reads the validated env
// (e.g. the database client) is evaluated. Scripts run from packages/database.
// Uses Node's built-in process.loadEnvFile() (Node ≥20.12); the catch guards
// the missing-file no-op and older runtimes.
try {
  process.loadEnvFile(path.resolve(process.cwd(), "../../.env"));
} catch {
  // .env absent or process.loadEnvFile unavailable — env set by shell/compose.
}
