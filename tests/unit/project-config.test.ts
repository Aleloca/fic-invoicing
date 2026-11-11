import { describe, expect, it } from "vitest";
import { STATEMENT_PRESETS } from "@/lib/fiscal/statements";
import {
  EMPTY_COMPANY_DEFAULTS,
  missingConfiguration,
  NO_OVERRIDES,
  resolveConfig,
  type CompanyDefaults,
} from "@/lib/projects/config";
import { buildIssuedDocumentPayload } from "@/lib/fiscal/payload";

const company: CompanyDefaults = {
  ...EMPTY_COMPANY_DEFAULTS,
  vatTypeId: 10,
  paymentAccountId: 20,
  paymentMethodId: 30,
  stampDutyVatTypeId: 40,
  numeration: "/A",
  itemCode: "SHOP",
  sendToSdi: true,
  fiscalStatements: { IT_PRIVATE: "Company text", EU_PRIVATE: "Company EU" },
};

describe("project settings resolution", () => {
  it("a project without overrides gets every company value", () => {
    const resolved = resolveConfig(company, NO_OVERRIDES);
    expect(resolved.invoice).toMatchObject({
      fiscalRegime: "FORFETTARIO",
      vatTypeId: 10,
      paymentAccountId: 20,
      paymentMethodId: 30,
      numeration: "/A",
      itemCode: "SHOP",
      eiPaymentMethod: "MP08",
      stampDutyMode: "CHARGED_TO_CUSTOMER",
      stampDutyVatTypeId: 40,
    });
    expect(resolved.sendToSdi).toBe(true);
    expect(resolved.overridden.size).toBe(0);
  });

  it("overrides win, including false and explicitly empty texts", () => {
    const resolved = resolveConfig(company, {
      ...NO_OVERRIDES,
      paymentAccountId: 99,
      numeration: "",
      itemCode: "APP",
      sendToSdi: false,
      stampDutyMode: "INCLUDED",
    });
    expect(resolved.invoice.paymentAccountId).toBe(99);
    expect(resolved.invoice.numeration).toBeNull();
    expect(resolved.invoice.itemCode).toBe("APP");
    expect(resolved.invoice.stampDutyMode).toBe("INCLUDED");
    expect(resolved.sendToSdi).toBe(false);
    expect([...resolved.overridden].sort()).toEqual([
      "itemCode",
      "numeration",
      "paymentAccountId",
      "sendToSdi",
      "stampDutyMode",
    ]);
  });

  it("statements merge per category: project, then company, then preset", () => {
    const resolved = resolveConfig(company, { ...NO_OVERRIDES, fiscalStatements: { IT_PRIVATE: "Project text" } });
    expect(resolved.invoice.statementOverrides).toEqual({ IT_PRIVATE: "Project text", EU_PRIVATE: "Company EU" });
    expect([...resolved.overriddenStatements]).toEqual(["IT_PRIVATE"]);

    const customer = {
      category: "EXTRAEU_PRIVATE" as const,
      firstName: "A",
      lastName: "B",
      address: "1 St",
      zipCode: "10001",
      city: "NYC",
      countryCode: "US",
      email: "a@example.com",
    };
    const built = buildIssuedDocumentPayload(resolved.invoice, {
      customer,
      amountCents: 100,
      description: "x",
      date: "2026-11-11",
    });
    expect(built.statement).toBe(STATEMENT_PRESETS.EXTRAEU_7TER);
  });

  it("missing settings are reported on the effective configuration", () => {
    expect(missingConfiguration(resolveConfig(company, NO_OVERRIDES).invoice)).toEqual([]);
    const bare = resolveConfig(EMPTY_COMPANY_DEFAULTS, { ...NO_OVERRIDES, vatTypeId: 5 });
    expect(missingConfiguration(bare.invoice)).toEqual(["payment account", "payment method", "stamp duty VAT type"]);
  });
});
