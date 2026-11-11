/**
 * The Fatture in Cloud document for an invoice to Apple: the proceeds of an App Store fiscal period,
 * one line per project, to a business in another EU country (reverse charge, recipient code XXXXXXX).
 * Pure function, like buildIssuedDocumentPayload.
 */
import type { AppleAccount } from "@prisma/client";
import { getCountryNameForFIC } from "../fiscal/countries";
import {
  centsToEuros,
  PayloadError,
  type BuiltPayload,
  type FicIssuedDocumentRequest,
  type InvoiceConfig,
} from "../fiscal/payload";
import { splitStampDuty } from "../fiscal/stamp-duty";
import { labelIt, periodFromCode } from "./calendar";

export interface AppStoreCustomer {
  name: string;
  vatNumber: string;
  address: string;
  zipCode: string;
  city: string;
  province: string;
  countryCode: string;
}

/** Apple's EU distribution entity, as on the invoices issued by hand so far. To confirm with the accountant. */
export const APPLE_DISTRIBUTION_INTERNATIONAL: AppStoreCustomer = {
  name: "Apple Distribution International Limited",
  vatNumber: "IE9700053D",
  address: "Hollyhill Industrial Estate",
  zipCode: "T23 YK84",
  city: "Hollyhill",
  province: "Cork",
  countryCode: "IE",
};

export function parseCustomer(value: unknown): AppStoreCustomer {
  const v = (value ?? {}) as Partial<Record<keyof AppStoreCustomer, unknown>>;
  const text = (key: keyof AppStoreCustomer) => (typeof v[key] === "string" ? (v[key] as string) : "");
  return {
    name: text("name"),
    vatNumber: text("vatNumber"),
    address: text("address"),
    zipCode: text("zipCode"),
    city: text("city"),
    province: text("province"),
    countryCode: text("countryCode").toUpperCase(),
  };
}

export interface AppStoreInvoiceLine {
  projectId: string;
  /** The app (project) name printed in the description. */
  appName: string;
  amountCents: number;
}

export interface AppStoreInvoiceInput {
  period: string;
  /** One per project, in the order printed. */
  lines: AppStoreInvoiceLine[];
  /** YYYY-MM-DD */
  date: string;
  transactionId?: string | null;
}

export type AppStoreSettings = Pick<
  AppleAccount,
  "customer" | "itemName" | "vatTypeId" | "paymentAccountId" | "paymentMethodId" | "eiPaymentMethod" | "statement"
>;

export const totalCents = (lines: Pick<AppStoreInvoiceLine, "amountCents">[]) => lines.reduce((sum, l) => sum + l.amountCents, 0);

/** "Proventi da distribuzione app ZenTap, report finanziario Apple periodo fiscale settembre 2026, Transaction ID: 411399920" */
export function appStoreDescription(appName: string, input: Pick<AppStoreInvoiceInput, "period" | "transactionId">): string {
  const month = labelIt(periodFromCode(input.period));
  const label = month.charAt(0).toUpperCase() + month.slice(1);
  const tid = input.transactionId?.trim();
  return `Proventi da distribuzione app ${appName}, report finanziario Apple periodo fiscale ${label}${tid ? `, Transaction ID: ${tid}` : ""}`;
}

function requireId(value: number | null, label: string): number {
  if (value === null || !Number.isInteger(value) || value <= 0) {
    throw new PayloadError("config", `The App Store invoice settings are missing ${label}`);
  }
  return value;
}

/**
 * Numeration and fiscal regime come from the project (its company); stamp duty, when due
 * (forfettario above €77.47), is declared and borne by the seller: Apple pays a fixed amount.
 */
export function buildAppStorePayload(
  settings: AppStoreSettings,
  config: Pick<InvoiceConfig, "fiscalRegime" | "stampDutyMode" | "numeration">,
  input: AppStoreInvoiceInput,
): BuiltPayload {
  if (input.lines.length === 0 || input.lines.some((l) => !Number.isInteger(l.amountCents) || l.amountCents <= 0)) {
    throw new PayloadError("input", "Every line needs a positive amount in euro");
  }
  const amountCents = totalCents(input.lines);
  const vatTypeId = requireId(settings.vatTypeId, "a VAT type");
  const paymentAccountId = requireId(settings.paymentAccountId, "a payment account");
  const paymentMethodId = requireId(settings.paymentMethodId, "a payment method");
  const customer = parseCustomer(settings.customer);
  const country = getCountryNameForFIC(customer.countryCode);
  if (!customer.name || !customer.vatNumber || !country) {
    throw new PayloadError("config", "The App Store customer needs a name, a VAT number and a valid country");
  }

  const { stampDutyCents, totalPaidCents } = splitStampDuty(
    config.fiscalRegime,
    config.stampDutyMode === "DISABLED" ? "DISABLED" : "INCLUDED",
    amountCents,
  );
  const statement = settings.statement?.trim() || null;

  const body: FicIssuedDocumentRequest = {
    data: {
      type: "invoice",
      ...(config.numeration ? { numeration: config.numeration } : {}),
      subject: "",
      visible_subject: "",
      entity: {
        name: customer.name,
        type: "company",
        vat_number: customer.vatNumber,
        tax_code: "",
        address_street: customer.address,
        address_postal_code: customer.zipCode,
        address_city: customer.city,
        address_province: customer.province,
        country,
        country_iso: customer.countryCode,
        email: "",
        // Foreign customers have no SDI recipient code.
        ei_code: customer.countryCode === "IT" ? "0000000" : "XXXXXXX",
      },
      date: input.date,
      currency: { id: "EUR" },
      use_gross_prices: false,
      items_list: input.lines.map((line) => ({
        product_id: null,
        code: "",
        name: settings.itemName,
        net_price: centsToEuros(line.amountCents),
        gross_price: centsToEuros(line.amountCents),
        category: "",
        qty: 1,
        vat: { id: vatTypeId },
        not_taxable: false,
        description: appStoreDescription(line.appName, input),
      })),
      payments_list: [
        {
          amount: centsToEuros(totalPaidCents),
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
      ei_type: "B2B",
      ei_description: settings.itemName,
      ei_data: { payment_method: settings.eiPaymentMethod },
      stamp_duty: centsToEuros(stampDutyCents),
      notes: statement ?? "",
    },
  };
  return { body, stampDutyCents, totalPaidCents, statement };
}
