import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Resolve aliases shared across every project. `projects` in vitest 4 do NOT
 * inherit `resolve.alias` from the parent config — each project has its own
 * Vite scope. We extract shared aliases into a helper to keep the project
 * blocks below DRY.
 */
const sharedResolveAlias = {
  react: resolve(__dirname, "apps/web/node_modules/react"),
  "react-dom": resolve(__dirname, "apps/web/node_modules/react-dom"),
  "@tanstack/react-query": resolve(
    __dirname,
    "apps/web/node_modules/@tanstack/react-query",
  ),
  "react-router": resolve(__dirname, "apps/web/node_modules/react-router"),
  "@orpc/client": resolve(__dirname, "apps/web/node_modules/@orpc/client"),
  // Workspace aliases — Vite-level, applied to every project's transform step.
  // More-specific aliases MUST come before the bare package alias so that
  // `@iris/database/drizzle/schema/sqlite` is not captured by the bare
  // `@iris/database` entry (longest-prefix match).
  "@iris/prices/pipeline": resolve(__dirname, "packages/prices/src/pipeline/index.ts"),
  "@iris/prices": resolve(__dirname, "packages/prices/src/index.ts"),
  "@iris/utils/format": resolve(__dirname, "packages/utils/src/lib/format.ts"),
  "@iris/utils": resolve(__dirname, "packages/utils/src/index.ts"),
  "@iris/database/drizzle/queries": resolve(
    __dirname,
    "packages/database/src/drizzle/queries/index.ts",
  ),
  "@iris/database/drizzle/schema/sqlite": resolve(
    __dirname,
    "packages/database/src/drizzle/schema/sqlite.ts",
  ),
  "@iris/database/drizzle/schema": resolve(__dirname, "packages/database/src/drizzle/schema/index.ts"),
  "@iris/database": resolve(__dirname, "packages/database/src/index.ts"),
};

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"],
    // vitest 4 removed `environmentMatchGlobs`; split the suite by environment
    // via `projects`. Each project carries its own copy of the workspace alias
    // map (vitest 4 projects do NOT inherit `resolve.alias` from the parent).
    projects: [
      {
        test: {
          name: "components",
          include: ["tests/components/**"],
          environment: "jsdom",
          setupFiles: ["./tests/setup.ts"],
        },
        resolve: { alias: sharedResolveAlias },
      },
      {
        test: {
          name: "unit",
          include: ["tests/unit/**"],
          environment: "node",
          setupFiles: ["./tests/setup.ts"],
        },
        resolve: { alias: sharedResolveAlias },
      },
      {
        test: {
          name: "acceptance",
          include: ["tests/acceptance/**"],
          environment: "node",
          setupFiles: ["./tests/setup.ts"],
        },
        resolve: { alias: sharedResolveAlias },
      },
    ],
  },
});
