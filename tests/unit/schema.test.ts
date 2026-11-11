import { describe, expect, it } from "vitest";
import { createInvoiceSchema } from "@/lib/invoices/schema";
import { RateLimiter } from "@/lib/rate-limit";

const base = {
  idempotencyKey: "order-1",
  amountCents: 1999,
  description: "Service",
  customer: {
    category: "IT_PRIVATE",
    firstName: "Mario",
    lastName: "Rossi",
    fiscalCode: "rssmra85t10a562s",
    address: "Via Roma 1",
    zipCode: "00100",
    city: "Roma",
    province: "rm",
    countryCode: "it",
    email: "Mario@Example.com",
  },
};

const withCustomer = (customer: Record<string, unknown>) => ({ ...base, customer: { ...base.customer, ...customer } });

describe("createInvoiceSchema", () => {
  it("accepts and normalises a valid IT_PRIVATE request", () => {
    const parsed = createInvoiceSchema.parse(base);
    expect(parsed.customer).toMatchObject({
      fiscalCode: "RSSMRA85T10A562S",
      province: "RM",
      countryCode: "IT",
      email: "mario@example.com",
    });
  });

  it("requires a valid fiscal code for IT_PRIVATE", () => {
    expect(createInvoiceSchema.safeParse(withCustomer({ fiscalCode: undefined })).success).toBe(false);
    expect(createInvoiceSchema.safeParse(withCustomer({ fiscalCode: "RSSMRA85T10A562T" })).success).toBe(false);
  });

  it("checks category / country consistency", () => {
    expect(createInvoiceSchema.safeParse(withCustomer({ category: "EU_PRIVATE", countryCode: "IT" })).success).toBe(false);
    expect(
      createInvoiceSchema.safeParse(withCustomer({ category: "EU_PRIVATE", countryCode: "FR", zipCode: "75001", province: undefined }))
        .success,
    ).toBe(true);
    expect(createInvoiceSchema.safeParse(withCustomer({ category: "EXTRAEU_PRIVATE", countryCode: "DE" })).success).toBe(false);
    expect(createInvoiceSchema.safeParse(withCustomer({ category: "EXTRAEU_PRIVATE", countryCode: "CH" })).success).toBe(true);
  });

  it("validates IT_BUSINESS: VAT number and SDI code or PEC", () => {
    const business = {
      category: "IT_BUSINESS",
      firstName: undefined,
      lastName: undefined,
      fiscalCode: undefined,
      companyName: "Example S.r.l.",
      vatNumber: "IT12345678903",
      sdiCode: "abc1234",
    };
    const ok = createInvoiceSchema.parse(withCustomer(business));
    expect(ok.customer).toMatchObject({ vatNumber: "12345678903", sdiCode: "ABC1234" });
    expect(createInvoiceSchema.safeParse(withCustomer({ ...business, sdiCode: undefined })).success).toBe(false);
    expect(createInvoiceSchema.safeParse(withCustomer({ ...business, sdiCode: undefined, pec: "x@pec.it" })).success).toBe(true);
    expect(createInvoiceSchema.safeParse(withCustomer({ ...business, vatNumber: "12345678901" })).success).toBe(false);
  });

  it("rejects non-integer amounts and future dates", () => {
    expect(createInvoiceSchema.safeParse({ ...base, amountCents: 19.99 }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...base, amountCents: 0 }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...base, paidAt: "2999-01-01" }).success).toBe(false);
    expect(createInvoiceSchema.parse({ ...base, paidAt: "2026-01-02" }).paidAt).toBe("2026-01-02");
  });
});

describe("RateLimiter", () => {
  it("blocks after the limit within a window and resets after it", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.hit("k", 0)).toBe(0);
    expect(limiter.hit("k", 10)).toBe(0);
    expect(limiter.hit("k", 20)).toBeGreaterThan(0);
    expect(limiter.hit("other", 20)).toBe(0);
    expect(limiter.hit("k", 1000)).toBe(0);
  });
});
