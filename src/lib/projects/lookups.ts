import { listPaymentAccounts, listPaymentMethods, listVatTypes } from "../fic/client";
import { getFicAccess } from "../fic/tokens";
import type { CompanyWithAccount } from "./config";

export interface Option {
  id: number;
  label: string;
}

/** Lists from the FIC company used by the settings forms. Null lists: type ids instead. */
export interface Lookups {
  vatTypes: Option[] | null;
  paymentAccounts: Option[] | null;
  paymentMethods: Option[] | null;
  error: string | null;
}

const EMPTY: Lookups = { vatTypes: null, paymentAccounts: null, paymentMethods: null, error: null };

export async function loadLookups(company: CompanyWithAccount | null): Promise<Lookups> {
  if (!company || company.account.needsReconnect || !company.account.refreshTokenEnc) return EMPTY;
  try {
    const token = await getFicAccess(company.accountId);
    const [vatTypes, accounts, methods] = await Promise.all([
      listVatTypes(token, company.ficCompanyId),
      listPaymentAccounts(token, company.ficCompanyId),
      listPaymentMethods(token, company.ficCompanyId),
    ]);
    return {
      vatTypes: vatTypes
        .filter((v) => !v.is_disabled)
        .map((v) => ({ id: v.id, label: `${v.value}% – ${v.description}${v.ei_type ? ` (${v.ei_type})` : ""}` })),
      paymentAccounts: accounts.map((a) => ({ id: a.id, label: a.name })),
      paymentMethods: methods.map((m) => ({ id: m.id, label: `${m.name}${m.is_default ? " (default)" : ""}` })),
      error: null,
    };
  } catch (error) {
    return { ...EMPTY, error: error instanceof Error ? error.message : "Could not load Fatture in Cloud settings" };
  }
}

/** The label of an id in a list, for showing an inherited value. */
export function labelOf(options: Option[] | null, id: number | null): string {
  if (id === null) return "Not set";
  return options?.find((o) => o.id === id)?.label ?? `#${id}`;
}
