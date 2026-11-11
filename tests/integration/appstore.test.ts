import { generateKeyPairSync, verify } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccount, suggestStartPeriod } from "@/lib/appstore/check";
import { APPLE_DISTRIBUTION_INTERNATIONAL } from "@/lib/appstore/payload";
import { encrypt } from "@/lib/crypto";
import { ApiError } from "@/lib/errors";
import { deleteInvoice, issueAppStoreInvoice, retryInvoice } from "@/lib/invoices/service";
import { prisma } from "@/lib/prisma";
import { PROJECT_INCLUDE } from "@/lib/projects/config";
import { createProject, hasTestDb, resetDb } from "../helpers/db";
import { installFicMock } from "../helpers/fic-mock";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const HEADER =
  "Start Date\tEnd Date\tUPC\tISRC/ISBN\tVendor Identifier\tQuantity\tPartner Share\tExtended Partner Share\tPartner Share Currency\tSales or Return\tApple Identifier\tArtist/Show/Developer/Author\tTitle\tLabel/Studio/Network/Developer/Publisher\tGrid\tProduct Type Identifier\tISAN/Other Identifier\tCountry Of Sale\tPre-order Flag\tPromo Code\tCustomer Price\tCustomer Currency";
const report = (...rows: [number, string, string, string][]) =>
  [
    HEADER,
    ...rows.map(([qty, ext, cur, country]) => `x\tx\t\t\tpro\t${qty}\t${ext}\t${ext}\t${cur}\tS\t1\t\tPro\t\t\tIA1\t\t${country}\t\t\t0.99\t${cur}`),
    `Total_Rows\t${rows.length}`,
  ].join("\n");

const REPORTS = {
  "2026-11": report([1, "30.63", "PHP", "PH"]),
  "2026-12": report([1, "0.57", "GBP", "GB"], [1, "27.70", "TRY", "TR"]),
};
const RATES = { GBP: 0.83785, TRY: 55.4846, PHP: 71.24 };
const NOW = new Date("2026-11-11T21:00:00Z");

async function appStoreProject(nextPeriod = "2026-11") {
  const { project } = await createProject();
  const account = await prisma.appStoreAccount.create({
    data: {
      projectId: project.id,
      issuerId: "issuer-1",
      keyId: "KEY123",
      privateKeyEnc: encrypt(PEM),
      vendorNumber: "93804615",
      appName: "ZenTap",
      customer: { ...APPLE_DISTRIBUTION_INTERNATIONAL },
      vatTypeId: 77,
      paymentAccountId: 88,
      paymentMethodId: 99,
      nextPeriod,
    },
  });
  return { project, account };
}

interface SentDocument {
  data: {
    entity: { name: string; vat_number: string; country_iso: string; ei_code: string; type: string };
    items_list: { name: string; description: string; net_price: number; vat: { id: number } }[];
    payments_list: { amount: number; payment_account: { id: number } }[];
    payment_method: { id: number };
    ei_type: string;
    ei_data: { payment_method: string };
    numeration?: string;
    stamp_duty: number;
  };
}

describe.skipIf(!hasTestDb)("App Store payouts (integration)", () => {
  beforeEach(resetDb);
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("stores new reports with the ECB estimate and moves past settled periods", async () => {
    const fic = installFicMock({ appleReports: REPORTS, ecbRates: RATES });
    const { account } = await appStoreProject("2026-10");

    const result = await checkAccount(account.id, NOW);

    // July (2026-10) had no sales and ended long ago; October (2027-01) ended recently: still awaited.
    expect(result).toEqual({ found: ["2026-11", "2026-12"], nextPeriod: "2027-01" });
    const reports = await prisma.appStoreReport.findMany({ orderBy: { period: "asc" } });
    expect(reports.map((r) => [r.period, r.status, r.estimatedCents])).toEqual([
      ["2026-11", "READY", 43],
      ["2026-12", "READY", 118],
    ]);
    expect(reports[1].lines).toEqual([
      { currency: "GBP", amount: "0.57", units: 1, countries: ["GB"] },
      { currency: "TRY", amount: "27.70", units: 1, countries: ["TR"] },
    ]);
    expect(reports[1].periodStart.toISOString().slice(0, 10)).toBe("2026-08-30");

    // The API is called with a JWT signed by the account's key.
    const call = fic.state.calls.find((c) => c.url.hostname === "api.appstoreconnect.apple.com")!;
    expect(call.url.searchParams.get("filter[vendorNumber]")).toBe("93804615");
    const [head, body, signature] = call.authorization!.replace("Bearer ", "").split(".");
    expect(JSON.parse(Buffer.from(head, "base64url").toString())).toMatchObject({ alg: "ES256", kid: "KEY123" });
    expect(JSON.parse(Buffer.from(body, "base64url").toString())).toMatchObject({ iss: "issuer-1", aud: "appstoreconnect-v1" });
    expect(
      verify("sha256", Buffer.from(`${head}.${body}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")),
    ).toBe(true);

    // A second check finds nothing new and does not duplicate.
    expect((await checkAccount(account.id, NOW)).found).toEqual([]);
    expect(await prisma.appStoreReport.count()).toBe(2);
  });

  it("keeps the report without an estimate when a currency has no ECB rate", async () => {
    installFicMock({ appleReports: { "2026-12": report([1, "3.00", "SAR", "SA"]) }, ecbRates: RATES });
    const { account } = await appStoreProject("2026-12");
    await checkAccount(account.id, NOW);
    const r = await prisma.appStoreReport.findFirstOrThrow();
    expect(r.estimatedCents).toBeNull();
  });

  it("records Apple errors on the account", async () => {
    const fic = installFicMock();
    fic.fetchMock.mockImplementationOnce(async () => new Response('{"errors":[{"title":"Unauthorized"}]}', { status: 401 }));
    const { account } = await appStoreProject("2026-12");
    await expect(checkAccount(account.id, NOW)).rejects.toThrow(/Unauthorized/);
    expect((await prisma.appStoreAccount.findUniqueOrThrow({ where: { id: account.id } })).lastError).toMatch(/Unauthorized/);
  });

  it("suggests starting after the latest report Apple has", async () => {
    installFicMock({ appleReports: REPORTS });
    expect(await suggestStartPeriod({ issuerId: "i", keyId: "k", privateKey: PEM, vendorNumber: "1" }, NOW)).toEqual({
      start: "2027-01",
      latest: "2026-12",
    });
  });

  it("issues the invoice to Apple with the confirmed amount, once", async () => {
    const fic = installFicMock({ appleReports: REPORTS, ecbRates: RATES });
    const { project, account } = await appStoreProject("2026-12");
    await checkAccount(account.id, NOW);
    const r = await prisma.appStoreReport.findFirstOrThrow();

    const invoice = await issueAppStoreInvoice(project, r.id, { amountCents: 118, date: "2026-11-11", transactionId: "411399920" });

    expect(invoice).toMatchObject({ status: "ISSUED", amountCents: 118, customerCategory: "EU_BUSINESS", ficNumber: "1/T" });
    const [create] = fic.callsTo(/^\/c\/\d+\/issued_documents$/);
    const data = (create.body as SentDocument).data;
    expect(data.entity).toMatchObject({ name: "Apple Distribution International Limited", vat_number: "IE9700053D", country_iso: "IE", ei_code: "XXXXXXX", type: "company" });
    expect(data.ei_type).toBe("B2B");
    expect(data.items_list).toEqual([
      expect.objectContaining({
        name: "Distribuzione applicazioni mobili",
        net_price: 1.18,
        vat: { id: 77 },
        description: "Proventi da distribuzione app ZenTap, report finanziario Apple periodo fiscale Settembre 2026, Transaction ID: 411399920",
      }),
    ]);
    expect(data.payments_list[0]).toMatchObject({ amount: 1.18, payment_account: { id: 88 } });
    expect(data.payment_method).toEqual({ id: 99 });
    expect(data.ei_data.payment_method).toBe("MP05");
    expect(data.numeration).toBe("/T");
    expect(data.stamp_duty).toBe(0);

    expect((await prisma.appStoreReport.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("INVOICED");
    await expect(issueAppStoreInvoice(project, r.id, { amountCents: 118, date: "2026-11-11" })).rejects.toBeInstanceOf(ApiError);
  });

  it("declares, never charges, the stamp duty above €77.47", async () => {
    const fic = installFicMock({ appleReports: REPORTS, ecbRates: RATES });
    const { project, account } = await appStoreProject("2026-12");
    await checkAccount(account.id, NOW);
    const r = await prisma.appStoreReport.findFirstOrThrow();
    await issueAppStoreInvoice(project, r.id, { amountCents: 10000, date: "2026-11-11" });
    const data = (fic.callsTo(/^\/c\/\d+\/issued_documents$/)[0].body as SentDocument).data;
    expect(data.stamp_duty).toBe(2);
    expect(data.items_list).toHaveLength(1);
    expect(data.payments_list[0].amount).toBe(100);
  });

  it("a failed invoice keeps the report; retry rebuilds it, deleting frees the report", async () => {
    const fic = installFicMock({ appleReports: REPORTS, ecbRates: RATES, failCreateWith: 422 });
    const { project, account } = await appStoreProject("2026-12");
    await checkAccount(account.id, NOW);
    const r = await prisma.appStoreReport.findFirstOrThrow();

    const failed = await issueAppStoreInvoice(project, r.id, { amountCents: 118, date: "2026-11-11" });
    expect(failed.status).toBe("FAILED");
    expect(await prisma.appStoreReport.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "READY", invoiceId: failed.id });

    fic.state.failCreateWith = 0;
    const fresh = await prisma.project.findUniqueOrThrow({ where: { id: project.id }, include: PROJECT_INCLUDE });
    const retried = await retryInvoice(fresh, failed.id);
    expect(retried.status).toBe("ISSUED");
    const sent = (fic.callsTo(/^\/c\/\d+\/issued_documents$/).at(-1)!.body as SentDocument).data;
    expect(sent.entity.ei_code).toBe("XXXXXXX");
    expect((await prisma.appStoreReport.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("INVOICED");

    await deleteInvoice(fresh, retried.id);
    expect(await prisma.appStoreReport.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "READY", invoiceId: null });
  });
});
