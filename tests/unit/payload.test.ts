import { describe, expect, it } from "vitest";
import {
  buildIssuedDocumentPayload,
  PayloadError,
  todayInItaly,
  type CustomerData,
  type InvoiceConfig,
} from "@/lib/fiscal/payload";
import { STATEMENT_PRESETS } from "@/lib/fiscal/statements";
import { computeStampDutyCents } from "@/lib/fiscal/stamp-duty";

const forfettario: InvoiceConfig = {
  fiscalRegime: "FORFETTARIO",
  vatTypeId: 10,
  nonTaxableVatTypeId: null,
  paymentAccountId: 20,
  paymentMethodId: 30,
  numeration: "/A",
  itemCode: "SKU-1",
  statementOverrides: null,
  eiPaymentMethod: "MP08",
  applyStampDuty: true,
};

const ordinario: InvoiceConfig = { ...forfettario, fiscalRegime: "ORDINARIO", vatTypeId: 11, nonTaxableVatTypeId: 12 };

const itPrivate: CustomerData = {
  category: "IT_PRIVATE",
  firstName: "Mario",
  lastName: "Rossi",
  fiscalCode: "RSSMRA85T10A562S",
  address: "Via Roma 1",
  zipCode: "00100",
  city: "Roma",
  province: "RM",
  countryCode: "IT",
  email: "mario@example.com",
};
const euPrivate: CustomerData = {
  category: "EU_PRIVATE",
  firstName: "Anna",
  lastName: "Schmidt",
  address: "Hauptstrasse 1",
  zipCode: "10115",
  city: "Berlin",
  countryCode: "DE",
  email: "anna@example.com",
};
const extraEuPrivate: CustomerData = {
  category: "EXTRAEU_PRIVATE",
  firstName: "John",
  lastName: "Smith",
  address: "1 Main St",
  zipCode: "10001",
  city: "New York",
  countryCode: "US",
  email: "john@example.com",
};
const itBusiness: CustomerData = {
  category: "IT_BUSINESS",
  companyName: "Example S.r.l.",
  vatNumber: "12345678903",
  sdiCode: "ABC1234",
  address: "Via Milano 2",
  zipCode: "20100",
  city: "Milano",
  province: "MI",
  countryCode: "IT",
  email: "billing@example.com",
};

const build = (config: InvoiceConfig, customer: CustomerData, amountCents = 5000, dryRun = false) =>
  buildIssuedDocumentPayload(config, { customer, amountCents, description: "Service", date: "2026-11-10", dryRun });

describe("stamp duty", () => {
  it("applies €2 only when forfettario, enabled and strictly above €77.47", () => {
    expect(computeStampDutyCents("FORFETTARIO", true, 7747)).toBe(0);
    expect(computeStampDutyCents("FORFETTARIO", true, 7748)).toBe(200);
    expect(computeStampDutyCents("FORFETTARIO", false, 10000)).toBe(0);
    expect(computeStampDutyCents("ORDINARIO", true, 10000)).toBe(0);
  });

  it("is added to the document and to the amount paid", () => {
    const { body, stampDutyCents } = build(forfettario, itPrivate, 10000);
    expect(stampDutyCents).toBe(200);
    expect(body.data.stamp_duty).toBe(2);
    expect(body.data.items_list[0].net_price).toBe(100);
    expect(body.data.payments_list[0].amount).toBe(102);
  });

  it("is zero at the threshold", () => {
    const { body } = build(forfettario, itPrivate, 7747);
    expect(body.data.stamp_duty).toBe(0);
    expect(body.data.payments_list[0].amount).toBe(77.47);
  });
});

describe("FORFETTARIO payloads", () => {
  it("IT_PRIVATE: B2C e-invoice with forfettario statement, person entity, config ids", () => {
    const { body, statement } = build(forfettario, itPrivate);
    expect(statement).toBe(STATEMENT_PRESETS.FORFETTARIO);
    expect(body.data.items_list[0]).toMatchObject({
      code: "SKU-1",
      name: "Service",
      net_price: 50,
      gross_price: 50,
      qty: 1,
      vat: { id: 10 },
      description: STATEMENT_PRESETS.FORFETTARIO,
    });
    expect(body.data).toMatchObject({
      type: "invoice",
      numeration: "/A",
      date: "2026-11-10",
      currency: { id: "EUR" },
      use_gross_prices: false,
      e_invoice: true,
      ei_type: "B2C",
      ei_data: { payment_method: "MP08" },
      payment_method: { id: 30 },
      notes: STATEMENT_PRESETS.FORFETTARIO,
      stamp_duty: 0,
    });
    expect(body.data.payments_list[0]).toEqual({
      amount: 50,
      due_date: "2026-11-10",
      paid_date: "2026-11-10",
      status: "paid",
      payment_account: { id: 20 },
    });
    expect(body.data.entity).toMatchObject({
      name: "Mario Rossi",
      type: "person",
      tax_code: "RSSMRA85T10A562S",
      address_province: "RM",
      country: "Italia",
      country_iso: "IT",
    });
    expect(body.options).toEqual({ dry_run: false });
  });

  it("EU_PRIVATE uses the 7-ter EU statement and the Italian FIC country name", () => {
    const { body } = build(forfettario, euPrivate);
    expect(body.data.items_list[0].description).toBe(STATEMENT_PRESETS.EU_PRIVATE_7TER);
    expect(body.data.entity.country).toBe("Germania");
    expect(body.data.entity.address_province).toBe("");
    expect(body.data.items_list[0].vat).toEqual({ id: 10 });
  });

  it("EXTRAEU_PRIVATE uses the 7-ter extra-EU statement", () => {
    const { body } = build(forfettario, extraEuPrivate);
    expect(body.data.notes).toBe(STATEMENT_PRESETS.EXTRAEU_7TER);
    expect(body.data.entity.country).toBe("Stati Uniti");
  });

  it("IT_BUSINESS is a B2B company entity with SDI code", () => {
    const { body } = build(forfettario, itBusiness);
    expect(body.data.ei_type).toBe("B2B");
    expect(body.data.entity).toMatchObject({
      name: "Example S.r.l.",
      type: "company",
      vat_number: "12345678903",
      tax_code: "12345678903",
      ei_code: "ABC1234",
      certified_email: "",
    });
    expect(body.data.notes).toBe(STATEMENT_PRESETS.FORFETTARIO);
  });

  it("IT_BUSINESS with PEC only uses recipient code 0000000", () => {
    const { body } = build(forfettario, { ...itBusiness, sdiCode: undefined, pec: "example@pec.it" });
    expect(body.data.entity.ei_code).toBe("0000000");
    expect(body.data.entity.certified_email).toBe("example@pec.it");
  });

  it("omits numeration when not configured and passes dry run through", () => {
    const { body } = build({ ...forfettario, numeration: null, itemCode: null }, itPrivate, 5000, true);
    expect("numeration" in body.data).toBe(false);
    expect(body.data.items_list[0].code).toBe("");
    expect(body.options.dry_run).toBe(true);
  });

  it("tenant overrides win; empty override prints nothing", () => {
    const { body } = build({ ...forfettario, statementOverrides: { IT_PRIVATE: "Custom text", EU_PRIVATE: "" } }, itPrivate);
    expect(body.data.notes).toBe("Custom text");
    const eu = build({ ...forfettario, statementOverrides: { EU_PRIVATE: "" } }, euPrivate);
    expect(eu.body.data.notes).toBe("");
    expect(eu.statement).toBeNull();
  });
});

describe("ORDINARIO payloads", () => {
  it("Italian customers get the configured VAT type, gross pricing and no statement", () => {
    const { body, statement, stampDutyCents } = build(ordinario, itPrivate, 12200);
    expect(statement).toBeNull();
    expect(stampDutyCents).toBe(0);
    expect(body.data.use_gross_prices).toBe(true);
    expect(body.data.items_list[0].vat).toEqual({ id: 11 });
    expect(body.data.items_list[0].gross_price).toBe(122);
    expect(body.data.items_list[0].net_price).toBeUndefined();
    expect(body.data.payments_list[0].amount).toBe(122);
    expect(body.data.notes).toBe("");
  });

  it("EU / extra-EU customers use the non-taxable VAT type and 7-ter statements", () => {
    const eu = build(ordinario, euPrivate);
    expect(eu.body.data.items_list[0].vat).toEqual({ id: 12 });
    expect(eu.statement).toBe(STATEMENT_PRESETS.EU_PRIVATE_7TER);
    const extra = build(ordinario, extraEuPrivate);
    expect(extra.statement).toBe(STATEMENT_PRESETS.EXTRAEU_7TER);
  });

  it("requires the non-taxable VAT type for foreign customers", () => {
    expect(() => build({ ...ordinario, nonTaxableVatTypeId: null }, euPrivate)).toThrow(PayloadError);
  });
});

describe("validation of config and input", () => {
  it("throws a config error when ids are missing", () => {
    try {
      build({ ...forfettario, paymentAccountId: null }, itPrivate);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PayloadError);
      expect((error as PayloadError).kind).toBe("config");
    }
  });

  it("throws an input error for unknown countries", () => {
    expect(() => build(forfettario, { ...extraEuPrivate, countryCode: "ZZ" })).toThrow(/Unknown country/);
  });
});

describe("todayInItaly", () => {
  it("uses the Europe/Rome calendar day", () => {
    expect(todayInItaly(new Date("2026-06-30T22:30:00Z"))).toBe("2026-07-01");
    expect(todayInItaly(new Date("2026-01-15T10:00:00Z"))).toBe("2026-01-15");
  });
});
