import { z } from "zod";
export { asRecord } from "@iris/utils";

/**
 * Standard "operation result" output shape (shared/typescript.md — every API
 * output includes `success` and `reason`). `success` is a literal `true` so
 * data-returning procedures stay consistent with the standard response format.
 */
export const okResultSchema = z.object({
  success: z.literal(true),
  reason: z.string(),
});

export type OkResult = z.infer<typeof okResultSchema>;

/**
 * Convert a nullable SQLite text price value to `number | null`.
 * Prices are written with two decimal places, so `Number()` is safe here.
 */
export function toNullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * Convert a SQLite text price value to `number`.
 */
export function toNumber(value: string): number {
  return Number(value);
}

