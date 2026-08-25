import { describe, expect, it } from "vitest";
import { envSchema } from "@iris/utils";

/**
 * Env schema enforcement (task #6): BETTER_AUTH_SECRET must not be the
 * committed dev default in production. Tests call `envSchema.parse` directly
 * on a raw object so they never touch process.env or the lazy env cache.
 */
function baseEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    // Minimal valid set: argus vars are required, everything else has defaults.
    ARGUS_BASE_URL: "http://localhost:8000",
    ARGUS_API_TOKEN: "test-token",
    ...overrides,
  };
}

describe("envSchema — BETTER_AUTH_SECRET production enforcement", () => {
  it("accepts the dev default in development", () => {
    const env = envSchema.parse(baseEnv({ NODE_ENV: "development" }));
    expect(env.BETTER_AUTH_SECRET).toBe("dev-secret-change-me");
  });

  it("accepts the dev default in test", () => {
    const env = envSchema.parse(baseEnv({ NODE_ENV: "test" }));
    expect(env.BETTER_AUTH_SECRET).toBe("dev-secret-change-me");
  });

  it("accepts a real secret in production", () => {
    const env = envSchema.parse(
      baseEnv({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: "a-real-long-randomly-generated-secret-value",
      }),
    );
    expect(env.BETTER_AUTH_SECRET).toBe("a-real-long-randomly-generated-secret-value");
  });

  it("rejects the dev default in production", () => {
    const result = envSchema.safeParse(
      baseEnv({ NODE_ENV: "production", BETTER_AUTH_SECRET: "dev-secret-change-me" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const secretIssue = result.error.issues.find((issue) =>
        issue.path.includes("BETTER_AUTH_SECRET"),
      );
      expect(secretIssue).toBeDefined();
      expect(secretIssue?.message).toContain("production");
    }
  });

  it("rejects an empty secret everywhere (min(1))", () => {
    const devResult = envSchema.safeParse(baseEnv({ BETTER_AUTH_SECRET: "" }));
    expect(devResult.success).toBe(false);
  });
});
