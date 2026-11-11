import { generateKeyPairSync, verify } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAccount, suggestStartPeriod } from "@/lib/appstore/check";
import { groupReport } from "@/lib/appstore/groups";
import { APPLE_DISTRIBUTION_INTERNATIONAL } from "@/lib/appstore/payload";
import type { ReportLine } from "@/lib/appstore/report";
import { encrypt } from "@/lib/crypto";
import { ApiError } from "@/lib/errors";
import { APPLE_ACCOUNT_INCLUDE, deleteAppleInvoice, issueAppStoreInvoice, retryAppleInvoice } from "@/lib/invoices/service";
import { prisma } from "@/lib/prisma";
import { createProject, hasTestDb, resetDb } from "../helpers/db";
import { installFicMock } from "../helpers/fic-mock";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const HEADER =
  "Start Date\tEnd Date\tUPC\tISRC/ISBN\tVendor Identifier\tQuantity\tPartner Share\tExtended Partner Share\tPartner Share Currency\tSales or Return\tApple Identifier\tArtist/Show/Developer/Author\tTitle\tLabel/Studio/Network/Developer/Publisher\tGrid\tProduct Type Identifier\tISAN/Other Identifier\tCountry Of Sale\tPre-order Flag\tPromo Code\tCustomer Price\tCustomer Currency";
const ZENTAP = ["6760715414", "zentap_pro_unlock", "ZenTap Pro Unlock"];
const OTHER = ["777", "moonlog_premium", "MoonLog Premium"];
const report = (...rows: [string[], number, string, string, string][]) =>
  [
    HEADER,
    ...rows.map(
      ([product, qty, ext, cur, country]) =>
        `x\tx\t\t\t${product[1]}\t${qty}\t${ext}\t${ext}\t${cur}\tS\t${product[0]}\t\t${product[2]}\t\t\tIA1\t\t${country}\t\t\t0.99\t${cur}`,
    ),
    `Total_Rows\t${rows.length}`,
  ].join("\n");

const REPORTS = {
  "2026-11": report([ZENTAP, 1, "30.63", "PHP", "PH"]),
  "2026-12": report([ZENTAP, 1, "0.57", "GBP", "GB"], [ZENTAP, 1, "27.70", "TRY", "TR"], [OTHER, 2, "1.40", "USD", "US"]),
};
const RATES = { GBP: 0.83785, TRY: 55.4846, PHP: 71.24, USD: 1.1133 };
const NOW = new Date("2026-11-11T21:00:00Z");

/** An Apple account issuing from the company of a first project (ZenTap), plus a second project (MoonLog). */
async function setup(nextPeriod = "2026-11", dryRun = false) {
  const zentap = await createProject({ overrides: { name: "ZenTap", slug: `zentap-${Date.now()}` } });
  const moonlog = await createProject({
    account: zentap.project.company!.account,
    companyId: zentap.project.companyId!,
    overrides: { name: "MoonLog", slug: `moonlog-${Date.now()}` },
  });
  const account = await prisma.appleAccount.create({
    data: {
      label: "Apple",
      issuerId: "issuer-1",
      keyId: "KEY123",
      privateKeyEnc: encrypt(PEM),
      vendorNumber: "93804615",
      companyId: zentap.project.companyId,
      dryRun,
      customer: { ...APPLE_DISTRIBUTION_INTERNATIONAL },
      vatTypeId: 77,
      paymentAccountId: 88,
      paymentMethodId: 99,
      nextPeriod,
    },
    include: APPLE_ACCOUNT_INCLUDE,
  });
  return { zentap: zentap.project, moonlog: moonlog.project, account };
}

async function assignAll(accountId: string, byAppleId: Record<string, string>) {
  for (const [appleId, projectId] of Object.entries(byAppleId)) {
    await prisma.appleProduct.update({ where: { accountId_appleId: { accountId, appleId } }, data: { projectId } });
  }
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

describe.skipIf(!hasTestDb)("Apple accounts and invoices to Apple (integration)", () => {
  beforeEach(resetDb);
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("stores new reports and products, with the ECB estimate, and moves past settled periods", async () => {
    const fic = installFicMock({ appleReports: REPORTS, ecbRates: RATES });
    const { account } = await setup("2026-10");

    const result = await checkAccount(account.id, NOW);

    // July (2026-10) had no sales and ended long ago; October (2027-01) ended recently: still awaited.
    expect(result).toEqual({ found: ["2026-11", "2026-12"], nextPeriod: "2027-01" });
    const reports = await prisma.appStoreReport.findMany({ orderBy: { period: "asc" } });
    expect(reports.map((r) => [r.period, r.status, r.estimatedCents])).toEqual([
      ["2026-11", "READY", 43],
      ["2026-12", "READY", 244],
    ]);
    const products = await prisma.appleProduct.findMany({ orderBy: { appleId: "asc" } });
    expect(products.map((p) => [p.appleId, p.sku, p.title, p.projectId])).toEqual([
      ["6760715414", "zentap_pro_unlock", "ZenTap Pro Unlock", null],
      ["777", "moonlog_premium", "MoonLog Premium", null],
    ]);

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
    expect(await prisma.appleProduct.count()).toBe(2);
  });

  it("groups a report by project once products are assigned", async () => {
    installFicMock({ appleReports: REPORTS, ecbRates: RATES });
    const { account, zentap, moonlog } = await setup("2026-12");
    await checkAccount(account.id, NOW);
    const r = await prisma.appStoreReport.findFirstOrThrow();
    const lines = r.lines as unknown as ReportLine[];
    const load = () => prisma.appleProduct.findMany({ include: { project: { select: { name: true } } } });

    expect(groupReport(lines, await load(), RATES).unassigned).toHaveLength(3);
    await assignAll(account.id, { "6760715414": zentap.id, "777": moonlog.id });
    const groups = groupReport(lines, await load(), RATES);
    expect(groups.unassigned).toEqual([]);
    expect(groups.projects.map((g) => [g.projectName, g.estimatedCents])).toEqual([
      ["MoonLog", 126],
      ["ZenTap", 118],
    ]);
  });

  it("records Apple errors on the account", async () => {
    const fic = installFicMock();
    fic.fetchMock.mockImplementationOnce(async () => new Response('{"errors":[{"title":"Unauthorized"}]}', { status: 401 }));
    const { account } = await setup("2026-12");
    await expect(checkAccount(account.id, NOW)).rejects.toThrow(/Unauthorized/);
    expect((await prisma.appleAccount.findUniqueOrThrow({ where: { id: account.id } })).lastError).toMatch(/Unauthorized/);
  });

  it("suggests starting after the latest report Apple has", async () => {
    installFicMock({ appleReports: REPORTS });
    expect(await suggestStartPeriod({ issuerId: "i", keyId: "k", privateKey: PEM, vendorNumber: "1" }, NOW)).toEqual({
      start: "2027-01",
      latest: "2026-12",
    });
  });

  it("issues one invoice to Apple with a line per project, owned by the Apple account", async () => {
    const fic = installFicMock({ appleReports: REPORTS, ecbRates: RATES });
    const { account, zentap, moonlog } = await setup("2026-12");
    await checkAccount(account.id, NOW);
    const r = await prisma.appStoreReport.findFirstOrThrow();

    const invoice = await issueAppStoreInvoice(account, r.id, {
      lines: [
        { projectId: moonlog.id, appName: "MoonLog", amountCents: 126 },
        { projectId: zentap.id, appName: "ZenTap", amountCents: 118 },
      ],
      date: "2026-11-11",
      transactionId: "411399920",
    });

    expect(invoice).toMatchObject({
      status: "ISSUED",
      amountCents: 244,
      customerCategory: "EU_BUSINESS",
      ficNumber: "1/T",
      projectId: null,
      appleAccountId: account.id,
      companyId: account.companyId,
    });
    const [create] = fic.callsTo(/^\/c\/\d+\/issued_documents$/);
    expect(create.url.pathname).toBe(`/c/${account.company!.ficCompanyId}/issued_documents`);
    const data = (create.body as SentDocument).data;
    expect(data.entity).toMatchObject({ name: "Apple Distribution International Limited", vat_number: "IE9700053D", country_iso: "IE", ei_code: "XXXXXXX", type: "company" });
    expect(data.ei_type).toBe("B2B");
    expect(data.items_list.map((i) => [i.name, i.net_price, i.vat.id, i.description])).toEqual([
      ["Distribuzione applicazioni mobili", 1.26, 77, "Proventi da distribuzione app MoonLog, report finanziario Apple periodo fiscale Settembre 2026, Transaction ID: 411399920"],
      ["Distribuzione applicazioni mobili", 1.18, 77, "Proventi da distribuzione app ZenTap, report finanziario Apple periodo fiscale Settembre 2026, Transaction ID: 411399920"],
    ]);
    expect(data.payments_list[0]).toMatchObject({ amount: 2.44, payment_account: { id: 88 } });
    expect(data.payment_method).toEqual({ id: 99 });
    expect(data.ei_data.payment_method).toBe("MP05");
    expect(data.numeration).toBe("/T");
    expect(data.stamp_duty).toBe(0);

    expect((await prisma.appStoreReport.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("INVOICED");
    await expect(
      issueAppStoreInvoice(account, r.id, { lines: [{ projectId: zentap.id, appName: "ZenTap", amountCents: 1 }], date: "2026-11-11" }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("follows the account's dry run and declares, never charges, the stamp duty above €77.47", async () => {
    const fic = installFicMock({ appleReports: REPORTS, ecbRates: RATES });
    const { account, zentap } = await setup("2026-12", true);
    await checkAccount(account.id, NOW);
    const r = await prisma.appStoreReport.findFirstOrThrow();
    const invoice = await issueAppStoreInvoice(account, r.id, { lines: [{ projectId: zentap.id, appName: "ZenTap", amountCents: 10000 }], date: "2026-11-11" });
    expect(invoice).toMatchObject({ status: "ISSUED", dryRun: true, ficNumber: null });
    expect(fic.callsTo(/^\/c\/\d+\/issued_documents$/)).toHaveLength(0);
    const totals = (fic.callsTo(/\/issued_documents\/totals$/)[0].body as SentDocument).data;
    expect(totals.stamp_duty).toBe(2);
    expect(totals.items_list).toHaveLength(1);
    expect(totals.payments_list[0].amount).toBe(100);
  });

  it("a failed invoice keeps the report; retry rebuilds it, deleting frees the report", async () => {
    const fic = installFicMock({ appleReports: REPORTS, ecbRates: RATES, failCreateWith: 422 });
    const { account, zentap } = await setup("2026-12");
    await checkAccount(account.id, NOW);
    const r = await prisma.appStoreReport.findFirstOrThrow();
    const lines = [{ projectId: zentap.id, appName: "ZenTap", amountCents: 118 }];

    const failed = await issueAppStoreInvoice(account, r.id, { lines, date: "2026-11-11" });
    expect(failed.status).toBe("FAILED");
    expect(await prisma.appStoreReport.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "READY", invoiceId: failed.id });

    fic.state.failCreateWith = 0;
    const retried = await retryAppleInvoice(account, failed.id);
    expect(retried.status).toBe("ISSUED");
    const sent = (fic.callsTo(/^\/c\/\d+\/issued_documents$/).at(-1)!.body as SentDocument).data;
    expect(sent.entity.ei_code).toBe("XXXXXXX");
    expect((await prisma.appStoreReport.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("INVOICED");

    await deleteAppleInvoice(account, retried.id);
    expect(await prisma.appStoreReport.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "READY", invoiceId: null });
  });
});
