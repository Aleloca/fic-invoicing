import type { FiscalRegime, StampDutyMode } from "./types";

/** Imposta di bollo on invoices without VAT: €2.00 ... */
export const STAMP_DUTY_CENTS = 200;
/** ... due when the amount exceeds €77.47. */
export const STAMP_DUTY_THRESHOLD_CENTS = 7747;

/**
 * Stamp duty for an invoice: €2 when the tenant is FORFETTARIO, the tenant mode
 * is not `DISABLED` and the caller's amount is strictly greater than €77.47.
 *
 * The threshold is always compared with the caller's `amountCents`, exactly as
 * before the modes existed. For `INCLUDED` this means: an amount that would be a
 * taxable line above €77.47 without the stamp gets the stamp. Between €77.48 and
 * €79.47 the line, once the €2 is carved out, ends up at or below €77.47 while the
 * stamp is still applied. This is deliberate: an unnecessary €2 stamp only costs
 * €2, a missing one that was due is a tax violation. It also guarantees that the
 * line keeps a positive amount (> €75.47) whenever the €2 is subtracted.
 */
export function computeStampDutyCents(regime: FiscalRegime, mode: StampDutyMode, amountCents: number): number {
  if (regime !== "FORFETTARIO" || mode === "DISABLED") return 0;
  return amountCents > STAMP_DUTY_THRESHOLD_CENTS ? STAMP_DUTY_CENTS : 0;
}

export interface StampDutySplit {
  /** Price of the invoice line (taxable part), EUR cents. */
  itemCents: number;
  /** Stamp duty printed on the invoice, EUR cents (0 or 200). */
  stampDutyCents: number;
  /** Invoice total and recorded payment, EUR cents. */
  totalPaidCents: number;
}

/**
 * Splits the caller's amount into invoice line, stamp duty and total paid.
 *
 * - `CHARGED_TO_CUSTOMER`: line = amount, stamp on top, total = amount + stamp.
 * - `INCLUDED`: the customer paid `amount` and the stamp is part of it:
 *   line = amount − stamp, total = amount.
 * - `DISABLED`: no stamp, line = total = amount.
 */
export function splitStampDuty(regime: FiscalRegime, mode: StampDutyMode, amountCents: number): StampDutySplit {
  const stampDutyCents = computeStampDutyCents(regime, mode, amountCents);
  if (mode === "INCLUDED") {
    const itemCents = amountCents - stampDutyCents;
    // Unreachable with the threshold above (stamp only when amount > 7747), kept as a guard.
    if (itemCents <= 0) throw new Error("Stamp duty would leave a non-positive invoice line");
    return { itemCents, stampDutyCents, totalPaidCents: amountCents };
  }
  return { itemCents: amountCents, stampDutyCents, totalPaidCents: amountCents + stampDutyCents };
}
