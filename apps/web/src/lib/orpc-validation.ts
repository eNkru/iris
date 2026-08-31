"use client";

import { ORPCError } from "@orpc/client";

/**
 * Field-level access to oRPC input-validation errors.
 *
 * When an oRPC procedure's Zod input schema rejects an input, the server
 * throws `BAD_REQUEST "Input validation failed"` with the machine-readable
 * Standard-Schema issues in `data.issues`. Rendering only `err.message` tells
 * the user nothing about WHICH field failed; these helpers let forms map an
 * issue's `path` back to a localized, field-specific dictionary message
 * (with the generic localized fallback as the safety net).
 */

interface StandardSchemaIssue {
  path?: ReadonlyArray<string | number | symbol> | undefined;
  message?: string | undefined;
}

/**
 * The set of validation issue paths attached to an error, e.g. `"url"`,
 * `"pollIntervalMinutes"`, `"alertRules.0.threshold"`. Empty for anything
 * that is not a validation error.
 */
export function validationIssuePaths(err: unknown): string[] {
  if (!(err instanceof ORPCError) || err.code !== "BAD_REQUEST") {
    return [];
  }

  const issues =
    (err.data as { issues?: StandardSchemaIssue[] } | undefined)?.issues;

  if (!Array.isArray(issues)) {
    return [];
  }

  return issues
    .map((issue) => (issue.path ?? []).map(String).join("."))
    .filter((path) => path !== "");
}

/**
 * Whether the error carries a validation issue for `pathPrefix` (the field
 * itself or anywhere nested under it, e.g. `alertRules` matches
 * `alertRules.0.threshold`).
 */
export function hasValidationIssue(err: unknown, pathPrefix: string): boolean {
  return validationIssuePaths(err).some(
    (path) => path === pathPrefix || path.startsWith(`${pathPrefix}.`),
  );
}
