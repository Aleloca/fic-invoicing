/**
 * Builds the Fatture in Cloud `POST /c/{company_id}/issued_documents` request body.
 * Pure function: no I/O, fully unit-tested.
 */
import { getCountryNameForFIC } from "./countries";
import { splitStampDuty } from "./stamp-duty";
import { resolveStatement, type StatementOverrides } from "./statements";
import { isItalianCategory, type CustomerCategory, type FiscalRegime, type StampDutyMode } from "./types";

export interface InvoiceConfig {
  fiscalRegime: FiscalRegime;
  vatTypeId: number | null;
  nonTaxableVatTypeId: number | null;
  paymentAccountId: number | null;
  paymentMethodId: number | null;
  numeration: string | null;
  itemCode: string | null;
  statementOverrides: StatementOverrides | null;
  eiPaymentMethod: string;
  stampDutyMode: StampDutyMode;
}

/** Customer data as validated by the API schema (already normalised). */
export interface CustomerData {
  category: CustomerCategory;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  fiscalCode?: string;
  vatNumber?: string;
  sdiCode?: string;
  pec?: string;
  address: string;
  zipCode: string;
  city: string;
  province?: string;
  countryCode: string;
  email: string;
}

export interface InvoiceInput {
  customer: CustomerData;
  /** EUR cents. For ORDINARIO Italian customers this is VAT-inclusive (gross). */
  amountCents: number;
  description: string;
  /** Document, due and paid date, `YYYY-MM-DD`. */
  date: string;
  dryRun: boolean;
}

export interface BuiltPayload {
  body: FicIssuedDocumentRequest;
  stampDutyCents: number;
  statement: string | null;
}

/** Thrown when the tenant configuration or the input cannot produce a valid document. */
export class PayloadError extends Error {
  constructor(
    public readonly kind: "config" | "input",
    message: string,
  ) {
    super(message);
    this.name = "PayloadError";
  }
}

export interface FicEntity {
  name: string;
  type: "person" | "company";
  vat_number: string;
  tax_code: string;
  address_street: string;
  address_postal_code: string;
  address_city: string;
  address_province: string;
  country: string;
  country_iso: string;
  email: string;
  ei_code?: string;
  certified_email?: string;
}

export interface FicIssuedDocumentRequest {
  data: {
    type: "invoice";
    numeration?: string;
    subject: string;
    visible_subject: string;
    entity: FicEntity;
    date: string;
    currency: { id: "EUR" };
    use_gross_prices: boolean;
    items_list: Array<{
      product_id: null;
      code: string;
      name: string;
      net_price?: number;
      gross_price: number;
      category: string;
      qty: number;
      vat: { id: number };
      not_taxable: boolean;
      description: string;
    }>;
    payments_list: Array<{
      amount: number;
      due_date: string;
      paid_date: string;
      status: "paid";
      payment_account: { id: number };
    }>;
    payment_method: { id: number };
    show_payments: boolean;
    show_payment_method: boolean;
    show_totals: "all";
    show_notification_button: boolean;
    show_tspay_button: boolean;
    e_invoice: true;
    ei_type: "B2C" | "B2B";
    ei_description: string;
    ei_data: { payment_method: string };
    stamp_duty: number;
    notes: string;
  };
  options: { dry_run: boolean };
}

/** Converts integer cents to a 2-decimal euro number. */
export function centsToEuros(cents: number): number {
  return Math.round(cents) / 100;
}

function requireId(value: number | null, label: string): number {
  if (value === null || !Number.isInteger(value) || value <= 0) {
    throw new PayloadError("config", `Tenant is missing ${label}`);
  }
  return value;
}

function buildEntity(customer: CustomerData): FicEntity {
  const country = getCountryNameForFIC(customer.countryCode);
  if (!country) {
    throw new PayloadError("input", `Unknown country code: ${customer.countryCode}`);
  }
  const base = {
    address_street: customer.address,
    address_postal_code: customer.zipCode,
    address_city: customer.city,
    address_province: customer.province ?? "",
    country,
    country_iso: customer.countryCode.toUpperCase(),
    email: customer.email,
  };

  if (customer.category === "IT_BUSINESS") {
    if (!customer.companyName || !customer.vatNumber) {
      throw new PayloadError("input", "IT_BUSINESS customers need companyName and vatNumber");
    }
    return {
      name: customer.companyName,
      type: "company",
      vat_number: customer.vatNumber,
      tax_code: customer.fiscalCode ?? customer.vatNumber,
      // "0000000" + PEC when the customer has no recipient code.
      ei_code: customer.sdiCode ?? "0000000",
      certified_email: customer.pec ?? "",
      ...base,
    };
  }

  return {
    name: [customer.firstName, customer.lastName].filter(Boolean).join(" "),
    type: "person",
    vat_number: "",
    tax_code: customer.fiscalCode ?? "",
    ...base,
  };
}

/**
 * Picks the VAT type for the invoice line.
 * - FORFETTARIO: the tenant VAT type (typically a 0% "regime forfettario" / out of scope type) for every category.
 * - ORDINARIO: the tenant VAT type for Italian customers, the non-taxable type for EU / extra-EU private customers.
 */
function pickVatTypeId(config: InvoiceConfig, category: CustomerCategory): number {
  if (config.fiscalRegime === "ORDINARIO" && !isItalianCategory(category)) {
    return requireId(config.nonTaxableVatTypeId, "a non-taxable VAT type (required for EU/extra-EU customers under ORDINARIO)");
  }
  return requireId(config.vatTypeId, "a VAT type");
}

export function buildIssuedDocumentPayload(config: InvoiceConfig, input: InvoiceInput): BuiltPayload {
  const { customer } = input;
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new PayloadError("input", "amountCents must be a positive integer");
  }

  const vatTypeId = pickVatTypeId(config, customer.category);
  const paymentAccountId = requireId(config.paymentAccountId, "a payment account");
  const paymentMethodId = requireId(config.paymentMethodId, "a payment method");
  const entity = buildEntity(customer);

  const statement = resolveStatement(config.fiscalRegime, customer.category, config.statementOverrides);
  // CHARGED_TO_CUSTOMER: line = amount, total paid = amount + stamp.
  // INCLUDED: the stamp is part of the amount paid, line = amount - stamp, total paid = amount.
  const { itemCents, stampDutyCents, totalPaidCents } = splitStampDuty(
    config.fiscalRegime,
    config.stampDutyMode,
    input.amountCents,
  );

  // ORDINARIO + Italian customer: the amount is VAT-inclusive, let FIC split net and VAT.
  const grossPricing = config.fiscalRegime === "ORDINARIO" && isItalianCategory(customer.category);
  const amount = centsToEuros(itemCents);
  const totalPaid = centsToEuros(totalPaidCents);

  const body: FicIssuedDocumentRequest = {
    data: {
      type: "invoice",
      ...(config.numeration ? { numeration: config.numeration } : {}),
      subject: "",
      visible_subject: input.description,
      entity,
      date: input.date,
      currency: { id: "EUR" },
      use_gross_prices: grossPricing,
      items_list: [
        {
          product_id: null,
          code: config.itemCode ?? "",
          name: input.description,
          ...(grossPricing ? {} : { net_price: amount }),
          gross_price: amount,
          category: "",
          qty: 1,
          vat: { id: vatTypeId },
          not_taxable: false,
          description: statement ?? "",
        },
      ],
      payments_list: [
        {
          amount: totalPaid,
          due_date: input.date,
          paid_date: input.date,
          status: "paid",
          payment_account: { id: paymentAccountId },
        },
      ],
      payment_method: { id: paymentMethodId },
      show_payments: true,
      show_payment_method: true,
      show_totals: "all",
      show_notification_button: false,
      show_tspay_button: false,
      e_invoice: true,
      ei_type: customer.category === "IT_BUSINESS" ? "B2B" : "B2C",
      ei_description: input.description,
      ei_data: { payment_method: config.eiPaymentMethod },
      stamp_duty: centsToEuros(stampDutyCents),
      notes: statement ?? "",
    },
    options: { dry_run: input.dryRun },
  };

  return { body, stampDutyCents, statement };
}

/** Today's date in Italy (Europe/Rome), `YYYY-MM-DD`. */
export function todayInItaly(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
