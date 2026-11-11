import type { FiscalRegime, StampDutyMode } from "./types";

/** Imposta di bollo on invoices without VAT: €2.00 ... */
export const STAMP_DUTY_CENTS = 200;
/** ... due when the amount exceeds €77.47. */
export const STAMP_DUTY_THRESHOLD_CENTS = 7747;

/**
 * Stamp duty for an invoice: €2 when the tenant is FORFETTARIO, the tenant mode
 * is not `DISABLED` and the caller's amount is strictly greater than €77.47.
 */
export function computeStampDutyCents(regime: FiscalRegime, mode: StampDutyMode, amountCents: number): number {
  if (regime !== "FORFETTARIO" || mode === "DISABLED") return 0;
  return amountCents > STAMP_DUTY_THRESHOLD_CENTS ? STAMP_DUTY_CENTS : 0;
}

export interface StampDutySplit {
  /** Price of the main invoice line, EUR cents. Always the caller's amount. */
  itemCents: number;
  /** Stamp duty declared on the e-invoice (`stamp_duty`), EUR cents (0 or 200). */
  stampDutyCents: number;
  /** Price of the separate "Rimborso imposta di bollo" line, EUR cents (0 or 200). */
  stampLineCents: number;
  /** Invoice total and recorded payment, EUR cents. */
  totalPaidCents: number;
}

/**
 * Splits the caller's amount into invoice lines, declared stamp duty and total paid.
 *
 * On e-invoices Fatture in Cloud does NOT add `stamp_duty` to the amount due: the
 * field only declares the (virtual) stamp, which the seller pays to the tax
 * authority. To charge the €2 to the customer it must be a separate invoice line.
 *
 * - `CHARGED_TO_CUSTOMER`: line = amount, plus a €2 "Rimborso imposta di bollo"
 *   line, total = amount + €2.
 * - `INCLUDED`: the seller bears the stamp (it is part of the fixed price the
 *   customer paid): line = total = amount, the €2 is only declared.
 * - `DISABLED`: no stamp, line = total = amount.
 */
export function splitStampDuty(regime: FiscalRegime, mode: StampDutyMode, amountCents: number): StampDutySplit {
  const stampDutyCents = computeStampDutyCents(regime, mode, amountCents);
  const stampLineCents = mode === "CHARGED_TO_CUSTOMER" ? stampDutyCents : 0;
  return {
    itemCents: amountCents,
    stampDutyCents,
    stampLineCents,
    totalPaidCents: amountCents + stampLineCents,
  };
}
