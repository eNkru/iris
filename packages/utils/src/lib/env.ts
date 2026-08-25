import { z } from "zod";

/**
 * Environment variables validated with Zod.
 *
 * Loaded lazily so importing this module never fails at build time when the
 * shell lacks the full environment; `getEnv()` throws only when a required
 * variable is actually missing at first use.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  // Database — a local SQLite file (the parent directory is created on startup).
  DATABASE_PATH: z.string().min(1, "DATABASE_PATH is required").default("./data/iris.db"),

  // SMTP — magic-link login emails (and future email alert channel)
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM: z.string().min(1).default("noreply@localhost"),

  // better-auth session signing secret. MUST be replaced in production; the
  // schema below rejects the dev default when NODE_ENV === "production".
  BETTER_AUTH_SECRET: z.string().min(1).default("dev-secret-change-me"),

  // Telegram alert channel
  TELEGRAM_BOT_TOKEN: z.string().default(""),

  // Local directory for downloaded product images.
  // Derived from the database directory by default.
  IMAGES_DIR: z.string().min(1).default("./data/images"),

  // Scheduler — in-process loop tick
  SCHEDULER_TICK_MS: z.coerce.number().int().positive().default(30_000),

  // Argus — the single fetch transport. The standalone argus service
  // (../argus) runs the anti-detect Camoufox browser that fetches product
  // pages behind hard anti-bot challenges (DataDome / Cloudflare / Akamai)
  // and classifies blocked pages (its registry supersedes iris's old
  // blocked-signatures.ts). It is a required dependency in every environment
  // (dev and prod): a missing value is a hard config error at first use,
  // matching `DATABASE_PATH`.
  ARGUS_BASE_URL: z.string().url("ARGUS_BASE_URL is required"),
  // Bearer token for argus /v1/* routes. Secret — never log it; it is only
  // ever placed in an Authorization header.
  ARGUS_API_TOKEN: z.string().min(1, "ARGUS_API_TOKEN is required"),
})
  // Enforce that the session-signing secret is NOT the committed dev default
  // in production. The dev default is fine for local `pnpm dev` (NODE_ENV is
  // development), but a production deploy that forgot to override it would
  // otherwise sign every session/magic-link with a publicly-known value →
  // trivial session forgery. Fail fast at first `getEnv()` instead.
  .superRefine((env, ctx) => {
    if (
      env.NODE_ENV === "production" &&
      env.BETTER_AUTH_SECRET === "dev-secret-change-me"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BETTER_AUTH_SECRET"],
        message:
          "BETTER_AUTH_SECRET must be set to a real secret in production (generate with: openssl rand -base64 32). The 'dev-secret-change-me' default is committed and unsafe.",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Parse a raw environment object (defaults to `process.env`) against the
 * schema. Exposed for tests and for packages that need a scoped subset.
 */
export function loadEnv(schema: z.ZodType<Env> = envSchema): Env {
  return schema.parse(process.env);
}

let cachedEnv: Env | undefined;

/**
 * Lazily validated environment singleton. Use everywhere server-side instead
 * of touching `process.env` directly.
 */
export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = loadEnv();
  }
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = undefined;
}
