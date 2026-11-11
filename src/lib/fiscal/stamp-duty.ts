import type { FiscalRegime } from "./types";

/** Imposta di bollo on invoices without VAT: €2.00 ... */
export const STAMP_DUTY_CENTS = 200;
/** ... due when the amount exceeds €77.47. */
export const STAMP_DUTY_THRESHOLD_CENTS = 7747;

/**
 * Stamp duty for an invoice: €2 when the tenant is FORFETTARIO, the tenant flag
 * `applyStampDuty` is on and the amount is strictly greater than €77.47.
 */
export function computeStampDutyCents(
  regime: FiscalRegime,
  applyStampDuty: boolean,
  amountCents: number,
): number {
  if (regime !== "FORFETTARIO" || !applyStampDuty) return 0;
  return amountCents > STAMP_DUTY_THRESHOLD_CENTS ? STAMP_DUTY_CENTS : 0;
}
