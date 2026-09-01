import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { hasValidationIssue, validationIssuePaths } from "../../apps/web/src/lib/orpc-validation";

/**
 * Tests for the client-side mapping of oRPC input-validation errors
 * (BAD_REQUEST + `data.issues`, the Standard-Schema issue shape emitted by
 * the server's validateInput step) to field-level form messages.
 */

function validationError(issues: Array<Record<string, unknown>>): ORPCError {
  return new ORPCError("BAD_REQUEST", {
    message: "Input validation failed",
    data: { issues },
  });
}

describe("validationIssuePaths", () => {
  it("returns the joined issue paths for a validation error", () => {
    const err = validationError([
      { path: ["url"], message: "Must be a valid http(s) URL" },
      { path: ["alertRules", 0, "threshold"], message: "Too small" },
    ]);
    expect(validationIssuePaths(err)).toEqual(["url", "alertRules.0.threshold"]);
  });

  it("returns [] for non-validation ORPC errors", () => {
    const err = new ORPCError("NOT_FOUND", { message: "Product not found" });
    expect(validationIssuePaths(err)).toEqual([]);
  });

  it("returns [] for non-ORPC errors and junk", () => {
    expect(validationIssuePaths(new Error("nope"))).toEqual([]);
    expect(validationIssuePaths(undefined)).toEqual([]);
    expect(validationIssuePaths({ code: "BAD_REQUEST" })).toEqual([]);
  });

  it("returns [] when data.issues is missing or malformed", () => {
    const err = new ORPCError("BAD_REQUEST", { message: "Input validation failed" });
    expect(validationIssuePaths(err)).toEqual([]);

    const junk = new ORPCError("BAD_REQUEST", {
      message: "Input validation failed",
      data: { issues: "not-an-array" },
    });
    expect(validationIssuePaths(junk)).toEqual([]);
  });
});

describe("hasValidationIssue", () => {
  const err = validationError([
    { path: ["url"], message: "bad url" },
    { path: ["alertRules", 0, "threshold"], message: "too small" },
  ]);

  it("matches a top-level field exactly", () => {
    expect(hasValidationIssue(err, "url")).toBe(true);
    expect(hasValidationIssue(err, "pollIntervalMinutes")).toBe(false);
  });

  it("matches nested fields under a prefix", () => {
    expect(hasValidationIssue(err, "alertRules")).toBe(true);
    expect(hasValidationIssue(err, "alertRules.0")).toBe(true);
    expect(hasValidationIssue(err, "alertRules.1")).toBe(false);
  });

  it("is false for non-validation errors", () => {
    expect(
      hasValidationIssue(new ORPCError("FORBIDDEN", { message: "no" }), "url"),
    ).toBe(false);
  });
});
