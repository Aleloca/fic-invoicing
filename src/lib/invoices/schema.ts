import { z } from "zod";
import { getCountryNameForFIC, isEUCountry, isItalianProvince } from "../fiscal/countries";
import type { CustomerData } from "../fiscal/payload";
import { todayInItaly } from "../fiscal/payload";
import { CUSTOMER_CATEGORIES } from "../fiscal/types";
import {
  isValidCodiceFiscale,
  isValidItalianZipCode,
  isValidPartitaIva,
  isValidSdiCode,
  isValidZipCode,
  normalizePartitaIva,
} from "../fiscal/validators";

const text = (max: number) => z.string().trim().min(1).max(max);

const customerSchema = z
  .object({
    category: z.enum(CUSTOMER_CATEGORIES),
    firstName: text(100).optional(),
    lastName: text(100).optional(),
    companyName: text(200).optional(),
    fiscalCode: z.string().trim().toUpperCase().max(16).optional(),
    vatNumber: z.string().trim().max(20).optional(),
    sdiCode: z.string().trim().toUpperCase().max(7).optional(),
    pec: z.string().trim().toLowerCase().pipe(z.email()).optional(),
    address: text(200),
    zipCode: text(12),
    city: text(100),
    province: z.string().trim().toUpperCase().max(4).optional(),
    countryCode: z.string().trim().toUpperCase().length(2),
    email: z.string().trim().toLowerCase().pipe(z.email()),
  })
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });

    if (!getCountryNameForFIC(c.countryCode)) issue("countryCode", "Unknown country code");

    const italian = c.category === "IT_PRIVATE" || c.category === "IT_BUSINESS";
    if (italian) {
      if (c.countryCode !== "IT") issue("countryCode", `${c.category} requires countryCode "IT"`);
      if (!isValidItalianZipCode(c.zipCode)) issue("zipCode", "Italian ZIP code (CAP) must be 5 digits");
      if (!c.province) issue("province", "Province is required for Italian customers");
      else if (!isItalianProvince(c.province)) issue("province", "Invalid Italian province code");
    } else if (!isValidZipCode(c.zipCode)) {
      issue("zipCode", "Invalid ZIP code");
    }

    if (c.category !== "IT_BUSINESS") {
      if (!c.firstName) issue("firstName", "Required");
      if (!c.lastName) issue("lastName", "Required");
    }

    switch (c.category) {
      case "IT_PRIVATE":
        if (!c.fiscalCode) issue("fiscalCode", "Fiscal code is required for Italian private customers");
        else if (!isValidCodiceFiscale(c.fiscalCode)) issue("fiscalCode", "Invalid fiscal code");
        break;
      case "EU_PRIVATE":
        if (c.countryCode === "IT" || !isEUCountry(c.countryCode)) {
          issue("countryCode", "EU_PRIVATE requires an EU country other than Italy");
        }
        break;
      case "EXTRAEU_PRIVATE":
        if (isEUCountry(c.countryCode)) issue("countryCode", "EXTRAEU_PRIVATE requires a non-EU country");
        break;
      case "IT_BUSINESS":
        if (!c.companyName) issue("companyName", "Required for IT_BUSINESS");
        if (!c.vatNumber) issue("vatNumber", "Required for IT_BUSINESS");
        else if (!isValidPartitaIva(c.vatNumber)) issue("vatNumber", "Invalid Italian VAT number (partita IVA)");
        if (c.fiscalCode && !isValidCodiceFiscale(c.fiscalCode) && !/^\d{11}$/.test(c.fiscalCode)) {
          issue("fiscalCode", "Invalid fiscal code");
        }
        if (c.sdiCode && !isValidSdiCode(c.sdiCode)) issue("sdiCode", "SDI recipient code must be 7 alphanumeric characters");
        if (!c.sdiCode && !c.pec) issue("sdiCode", "IT_BUSINESS requires sdiCode or pec");
        break;
    }
  })
  .transform((c): CustomerData => ({
    ...c,
    vatNumber: c.vatNumber ? normalizePartitaIva(c.vatNumber) : undefined,
    fiscalCode: c.fiscalCode || undefined,
    province: c.province || undefined,
    sdiCode: c.sdiCode || undefined,
  }));

const paidAtSchema = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })])
  .transform((value) => (value.length === 10 ? value : todayInItaly(new Date(value))))
  .refine((date) => date <= todayInItaly(), { message: "paidAt cannot be in the future" });

export const createInvoiceSchema = z.object({
  idempotencyKey: text(191),
  externalRef: text(191).optional(),
  customer: customerSchema,
  amountCents: z.number().int().positive().max(100_000_000),
  description: text(1000),
  paidAt: paidAtSchema.optional(),
  dryRun: z.boolean().optional(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export function formatZodIssues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}
