import { z } from "zod";

/**
 * Per-product alert rules stored in `products.alertRules` (jsonb).
 * Default behavior: alert on any change. Thresholds (rise/fall, percent and/or
 * absolute) can be configured separately (R10).
 */
export const alertRulesSchema = z
  .object({
    anyChange: z.boolean().optional(),
    risePct: z.number().positive().optional(),
    fallPct: z.number().positive().optional(),
    riseAbs: z.number().positive().optional(),
    fallAbs: z.number().positive().optional(),
  })
  .nullable();
export type AlertRules = z.infer<typeof alertRulesSchema>;
