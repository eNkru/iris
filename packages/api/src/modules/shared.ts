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
