export const CUSTOMER_CATEGORIES = ["IT_PRIVATE", "EU_PRIVATE", "EXTRAEU_PRIVATE", "IT_BUSINESS"] as const;
export type CustomerCategory = (typeof CUSTOMER_CATEGORIES)[number];

export const FISCAL_REGIMES = ["FORFETTARIO", "ORDINARIO"] as const;
export type FiscalRegime = (typeof FISCAL_REGIMES)[number];

export function isItalianCategory(category: CustomerCategory): boolean {
  return category === "IT_PRIVATE" || category === "IT_BUSINESS";
}
