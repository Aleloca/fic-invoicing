/**
 * A project issues invoices from a company and inherits the company's settings.
 * Every nullable setting on the project is an override: null means "use the company value".
 */
import type { Company, FicAccount, Prisma, Project } from "@prisma/client";
import type { InvoiceConfig } from "../fiscal/payload";
import { parseStatementOverrides, type StatementOverrides } from "../fiscal/statements";
import type { StampDutyMode } from "../fiscal/types";

export type CompanyWithAccount = Company & { account: FicAccount };
export type ProjectWithCompany = Project & { company: CompanyWithAccount | null };

/** Prisma `include` that loads what invoice issuing needs. */
export const PROJECT_INCLUDE = { company: { include: { account: true } } } satisfies Prisma.ProjectInclude;

/** Settings a project can override. `fiscalRegime` is a fact of the company and is not here. */
export const OVERRIDABLE = [
  "vatTypeId",
  "nonTaxableVatTypeId",
  "paymentAccountId",
  "paymentMethodId",
  "numeration",
  "itemCode",
  "eiPaymentMethod",
  "stampDutyMode",
  "stampDutyVatTypeId",
  "sendToSdi",
] as const;
export type OverridableKey = (typeof OVERRIDABLE)[number];

/** The company defaults, as stored on `Company`. */
export type CompanyDefaults = Pick<Company, "fiscalRegime" | "fiscalStatements" | OverridableKey>;

/** The project overrides, as stored on `Project`. */
export type ProjectOverrides = Pick<Project, "fiscalStatements" | OverridableKey>;

/** Defaults of a company that does not exist yet: the schema defaults. */
export const EMPTY_COMPANY_DEFAULTS: CompanyDefaults = {
  fiscalRegime: "FORFETTARIO",
  vatTypeId: null,
  nonTaxableVatTypeId: null,
  paymentAccountId: null,
  paymentMethodId: null,
  numeration: null,
  itemCode: null,
  fiscalStatements: null,
  eiPaymentMethod: "MP08",
  stampDutyMode: "CHARGED_TO_CUSTOMER",
  stampDutyVatTypeId: null,
  sendToSdi: false,
};

/** A project that follows every company default. */
export const NO_OVERRIDES: ProjectOverrides = {
  vatTypeId: null,
  nonTaxableVatTypeId: null,
  paymentAccountId: null,
  paymentMethodId: null,
  numeration: null,
  itemCode: null,
  fiscalStatements: null,
  eiPaymentMethod: null,
  stampDutyMode: null,
  stampDutyVatTypeId: null,
  sendToSdi: null,
};

export interface ResolvedConfig {
  invoice: InvoiceConfig;
  sendToSdi: boolean;
  /** Which settings come from the project rather than the company. */
  overridden: Set<OverridableKey>;
  /** Customer categories whose statement comes from the project. */
  overriddenStatements: Set<string>;
}

/** "" on a text override means "explicitly empty": it resolves to null, not to the company value. */
function textValue(value: string | null): string | null {
  return value === "" ? null : value;
}

/** Merges the company and project statement texts per customer category; the project wins. */
export function mergeStatements(company: unknown, project: unknown): StatementOverrides | null {
  const merged = { ...(parseStatementOverrides(company) ?? {}), ...(parseStatementOverrides(project) ?? {}) };
  return Object.keys(merged).length > 0 ? merged : null;
}

/** The effective settings of a project: its overrides on top of its company's defaults. */
export function resolveConfig(company: CompanyDefaults | null, project: ProjectOverrides): ResolvedConfig {
  const base = company ?? EMPTY_COMPANY_DEFAULTS;
  const overridden = new Set<OverridableKey>(OVERRIDABLE.filter((key) => project[key] !== null));
  const pick = <K extends OverridableKey>(key: K): NonNullable<Company[K]> | null =>
    (project[key] ?? base[key]) as NonNullable<Company[K]> | null;
  const projectStatements = parseStatementOverrides(project.fiscalStatements) ?? {};

  return {
    invoice: {
      fiscalRegime: base.fiscalRegime,
      vatTypeId: pick("vatTypeId"),
      nonTaxableVatTypeId: pick("nonTaxableVatTypeId"),
      paymentAccountId: pick("paymentAccountId"),
      paymentMethodId: pick("paymentMethodId"),
      numeration: textValue(pick("numeration")),
      itemCode: textValue(pick("itemCode")),
      statementOverrides: mergeStatements(base.fiscalStatements, project.fiscalStatements),
      eiPaymentMethod: pick("eiPaymentMethod") ?? "MP08",
      stampDutyMode: (pick("stampDutyMode") ?? "CHARGED_TO_CUSTOMER") as StampDutyMode,
      stampDutyVatTypeId: pick("stampDutyVatTypeId"),
    },
    sendToSdi: pick("sendToSdi") ?? false,
    overridden,
    overriddenStatements: new Set(Object.keys(projectStatements)),
  };
}

/** Settings still missing before invoices can be issued, in plain words. */
export function missingConfiguration(config: InvoiceConfig): string[] {
  const missing: string[] = [];
  if (config.vatTypeId === null) missing.push("VAT type");
  if (config.paymentAccountId === null) missing.push("payment account");
  if (config.paymentMethodId === null) missing.push("payment method");
  if (
    config.fiscalRegime === "FORFETTARIO" &&
    config.stampDutyMode === "CHARGED_TO_CUSTOMER" &&
    config.stampDutyVatTypeId === null
  ) {
    missing.push("stamp duty VAT type");
  }
  return missing;
}

/** How a project stands with Fatture in Cloud, from its company and that company's account. */
export type ConnectionState = "no_company" | "not_connected" | "reconnect" | "ready";

export function connectionState(project: { company: CompanyWithAccount | null }): ConnectionState {
  const account = project.company?.account;
  if (!project.company || !account) return "no_company";
  if (account.needsReconnect) return "reconnect";
  if (!account.accessTokenEnc || !account.refreshTokenEnc) return "not_connected";
  return "ready";
}
