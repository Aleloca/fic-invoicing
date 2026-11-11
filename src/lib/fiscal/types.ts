export const CUSTOMER_CATEGORIES = ["IT_PRIVATE", "EU_PRIVATE", "EXTRAEU_PRIVATE", "IT_BUSINESS"] as const;
export type CustomerCategory = (typeof CUSTOMER_CATEGORIES)[number];

export const FISCAL_REGIMES = ["FORFETTARIO", "ORDINARIO"] as const;
export type FiscalRegime = (typeof FISCAL_REGIMES)[number];

export function isItalianCategory(category: CustomerCategory): boolean {
  return category === "IT_PRIVATE" || category === "IT_BUSINESS";
}

/** How the €2 stamp duty (imposta di bollo) is handled, per company (projects can override it). Mirrors the Prisma enum. */
export const STAMP_DUTY_MODES = ["CHARGED_TO_CUSTOMER", "INCLUDED", "DISABLED"] as const;
export type StampDutyMode = (typeof STAMP_DUTY_MODES)[number];
