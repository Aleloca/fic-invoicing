import { CUSTOMER_CATEGORIES, type CustomerCategory, type FiscalRegime } from "./types";

/**
 * Preset fiscal statements (diciture) printed on the invoice line and in the notes.
 * These are common formulations, NOT tax advice: verify them with your accountant
 * and override them per tenant when needed.
 */
export const STATEMENT_PRESETS = {
  FORFETTARIO:
    "Operazione non soggetta a IVA ai sensi dell'art. 1, comma 58, L. 190/2014 (regime forfettario). Si applica il regime forfettario – Imposta di bollo assolta virtualmente ove dovuta.",
  EU_PRIVATE_7TER:
    "Operazione non soggetta ai sensi dell'art. 7-ter DPR 633/72 – Servizio generico reso a soggetto privato UE.",
  EXTRAEU_7TER: "Operazione non soggetta ai sensi dell'art. 7-ter DPR 633/72 – Servizio reso a soggetto extra-UE.",
} as const;

export type StatementOverrides = Partial<Record<CustomerCategory, string>>;

/** Preset statement for a regime/category pair; null means "no statement". */
export function presetStatement(regime: FiscalRegime, category: CustomerCategory): string | null {
  switch (category) {
    case "EU_PRIVATE":
      return STATEMENT_PRESETS.EU_PRIVATE_7TER;
    case "EXTRAEU_PRIVATE":
      return STATEMENT_PRESETS.EXTRAEU_7TER;
    case "IT_PRIVATE":
    case "IT_BUSINESS":
      // ORDINARIO: Italian customers are charged VAT, no exemption statement.
      return regime === "FORFETTARIO" ? STATEMENT_PRESETS.FORFETTARIO : null;
  }
}

/**
 * Resolves the statement for an invoice. A tenant override for the category wins
 * over the preset; an empty override string means "print no statement".
 */
export function resolveStatement(
  regime: FiscalRegime,
  category: CustomerCategory,
  overrides: StatementOverrides | null | undefined,
): string | null {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, category)) {
    const value = overrides[category]?.trim() ?? "";
    return value === "" ? null : value;
  }
  return presetStatement(regime, category);
}

/** Parses the tenant `fiscalStatements` JSON column, ignoring unknown keys and non-string values. */
export function parseStatementOverrides(value: unknown): StatementOverrides | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: StatementOverrides = {};
  for (const category of CUSTOMER_CATEGORIES) {
    const entry = (value as Record<string, unknown>)[category];
    if (typeof entry === "string") result[category] = entry;
  }
  return Object.keys(result).length > 0 ? result : null;
}
