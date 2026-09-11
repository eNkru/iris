/**
 * Convert an arbitrary DB JSON value into the `Record<string, unknown>` the
 * output schemas and channel adapters expect. Malformed configs degrade to an
 * empty record (no blind type assertions — shared/typescript.md).
 */
export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
