import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getInvoice } from "@/app/api/v1/invoices/[id]/route";
import { GET as getPdf } from "@/app/api/v1/invoices/[id]/pdf/route";
import { POST as retry } from "@/app/api/v1/invoices/[id]/retry/route";
import { POST as createInvoice } from "@/app/api/v1/invoices/route";
import { GET as health } from "@/app/api/v1/health/route";
import { apiRateLimiter } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createTenant, hasTestDb, resetDb } from "../helpers/db";
import { installFicMock } from "../helpers/fic-mock";
import { apiRequest, params } from "../helpers/http";

const body = (overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: "order-1",
  externalRef: "ext-1",
  amountCents: 10000,
  description: "Consulting",
  customer: {
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
  },
  ...overrides,
});

interface SentDocument {
  data: {
    stamp_duty: number;
    items_list: { code: string; name: string; net_price: number; vat: { id: number } }[];
    payments_list: { amount: number }[];
  };
}

const post = (apiKey: string | undefined, payload: unknown) =>
  createInvoice(apiRequest("/api/v1/invoices", { method: "POST", apiKey, body: payload }));

describe.skipIf(!hasTestDb)("public API (integration)", () => {
  beforeEach(async () => {
    await resetDb();
    apiRateLimiter().reset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("health check needs no auth", async () => {
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: "ok" });
  });

  describe("authentication", () => {
    it("401 without or with a wrong key, using the standard error shape", async () => {
      installFicMock();
      const missing = await post(undefined, body());
      expect(missing.status).toBe(401);
      expect(await missing.json()).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });

      const wrong = await post("fici_wrong", body());
      expect(wrong.status).toBe(401);
      expect((await wrong.json()).error.code).toBe("unauthorized");
    });

    it("403 for a disabled tenant", async () => {
      const { apiKey } = await createTenant({ active: false });
      const res = await post(apiKey, body());
      expect(res.status).toBe(403);
    });

    it("tenants cannot see each other's invoices (404)", async () => {
      const fic = installFicMock();
      const a = await createTenant();
      const b = await createTenant();
      const created = await (await post(a.apiKey, body())).json();

      const asOwner = await getInvoice(apiRequest(`/api/v1/invoices/${created.id}`, { apiKey: a.apiKey }), params({ id: created.id }));
      expect(asOwner.status).toBe(200);

      for (const res of [
        await getInvoice(apiRequest(`/x`, { apiKey: b.apiKey }), params({ id: created.id })),
        await getPdf(apiRequest(`/x`, { apiKey: b.apiKey }), params({ id: created.id })),
        await retry(apiRequest(`/x`, { method: "POST", apiKey: b.apiKey }), params({ id: created.id })),
      ]) {
        expect(res.status).toBe(404);
        expect((await res.json()).error.code).toBe("not_found");
      }
      expect(fic.callsTo(/preview_url/, "GET")).toHaveLength(0);
    });

    it("rate limits per key with 429 and Retry-After", async () => {
      process.env.RATE_LIMIT_PER_MINUTE = "1000";
      const { apiKey } = await createTenant();
      const limiter = apiRateLimiter();
      for (let i = 0; i < 1000; i++) limiter.hit((await import("@/lib/api-key")).hashApiKey(apiKey));
      const res = await getInvoice(apiRequest("/x", { apiKey }), params({ id: "nope" }));
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeTruthy();
    });
  });

  describe("create", () => {
    it("issues an invoice: totals pre-check, then create: 201, stamp duty line, number, payload purged", async () => {
      const fic = installFicMock();
      const { tenant, apiKey } = await createTenant();
      const res = await post(apiKey, body());
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json).toMatchObject({
        status: "ISSUED",
        number: "1/T",
        ficDocumentId: 5001,
        amountCents: 10000,
        stampDutyCents: 200,
        dryRun: false,
        errorMessage: null,
        externalRef: "ext-1",
      });

      const ficPaths = fic.state.calls.filter((c) => c.url.hostname === "fic.test").map((c) => c.url.pathname);
      expect(ficPaths).toEqual([
        `/c/${tenant.ficCompanyId}/issued_documents/totals`,
        `/c/${tenant.ficCompanyId}/issued_documents`,
      ]);
      const [totalsCall] = fic.callsTo(/\/issued_documents\/totals$/);
      const [call] = fic.callsTo(new RegExp(`^/c/${tenant.ficCompanyId}/issued_documents$`));
      expect(call.authorization).toBe("Bearer access-0");
      expect(totalsCall.body).toEqual({ data: (call.body as SentDocument).data });
      expect(Object.keys(call.body as object)).toEqual(["data"]);

      // CHARGED_TO_CUSTOMER (default): €100 line + €2 bollo line, stamp declared, paid €102.
      const data = (call.body as SentDocument).data;
      expect(data.stamp_duty).toBe(2);
      expect(data.items_list.map((i) => [i.code, i.net_price, i.vat.id])).toEqual([
        ["ITEM", 100, 10],
        ["BOLLO", 2, 40],
      ]);
      expect(data.payments_list[0].amount).toBe(102);

      const row = await prisma.invoice.findUniqueOrThrow({ where: { id: json.id } });
      expect(row.requestPayload).toBeNull();
      expect(row.attempts).toBe(1);
    });

    it("INCLUDED stamp duty: line = amount, stamp declared, payment = amount, response keeps the caller's amount", async () => {
      const fic = installFicMock();
      const { tenant, apiKey } = await createTenant({ stampDutyMode: "INCLUDED", stampDutyVatTypeId: null });
      const res = await post(apiKey, body());
      expect(res.status).toBe(201);
      expect(await res.json()).toMatchObject({ status: "ISSUED", amountCents: 10000, stampDutyCents: 200 });

      const [call] = fic.callsTo(new RegExp(`^/c/${tenant.ficCompanyId}/issued_documents$`));
      const data = (call.body as SentDocument).data;
      expect(data.stamp_duty).toBe(2);
      expect(data.items_list).toHaveLength(1);
      expect(data.items_list[0].net_price).toBe(100);
      expect(data.payments_list[0].amount).toBe(100);
    });

    it("CHARGED_TO_CUSTOMER without a stamp duty VAT type: 409 tenant_not_configured when the stamp applies", async () => {
      const fic = installFicMock();
      const { apiKey } = await createTenant({ stampDutyVatTypeId: null });
      const res = await post(apiKey, body());
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error.code).toBe("tenant_not_configured");
      expect(json.error.message).toMatch(/stamp duty VAT type/);
      expect(await prisma.invoice.count()).toBe(0);
      expect(fic.callsTo(/issued_documents/)).toHaveLength(0);

      // Below the threshold no stamp is due: the invoice is issued.
      const small = await post(apiKey, body({ idempotencyKey: "order-small", amountCents: 5000 }));
      expect(small.status).toBe(201);
      expect(await small.json()).toMatchObject({ status: "ISSUED", stampDutyCents: 0 });
    });

    it("totals mismatch: FAILED with both amounts, nothing created in FIC", async () => {
      const fic = installFicMock();
      fic.state.amountDueOverride = 100;
      const { apiKey } = await createTenant();
      const res = await post(apiKey, body());
      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json).toMatchObject({ status: "FAILED", ficDocumentId: null, number: null, error: { code: "fic_error" } });
      expect(json.errorMessage).toContain("€102.00");
      expect(json.errorMessage).toContain("€100.00");
      expect(fic.callsTo(/\/issued_documents\/totals$/)).toHaveLength(1);
      expect(fic.callsTo(/issued_documents$/)).toHaveLength(0);
      expect(fic.state.nextNumber).toBe(1);
    });

    it("totals rejected by FIC: FAILED with the FIC message, nothing created", async () => {
      const fic = installFicMock({ failTotalsWith: 422 });
      const { apiKey } = await createTenant();
      const res = await post(apiKey, body());
      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.status).toBe("FAILED");
      expect(json.errorMessage).toContain("FIC HTTP 422: Totals failed");
      expect(fic.callsTo(/issued_documents$/)).toHaveLength(0);
    });

    it("is idempotent per tenant: same key returns the existing invoice with 200", async () => {
      const fic = installFicMock();
      const { apiKey } = await createTenant();
      const first = await post(apiKey, body());
      const second = await post(apiKey, body({ amountCents: 999 }));
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      const [a, b] = [await first.json(), await second.json()];
      expect(b.id).toBe(a.id);
      expect(b.amountCents).toBe(10000);
      expect(fic.callsTo(/issued_documents$/)).toHaveLength(1);
      expect(await prisma.invoice.count()).toBe(1);
    });

    it("the same idempotency key in another tenant is a different invoice", async () => {
      installFicMock();
      const a = await createTenant();
      const b = await createTenant();
      const ra = await (await post(a.apiKey, body())).json();
      const rb = await (await post(b.apiKey, body())).json();
      expect(ra.id).not.toBe(rb.id);
    });

    it("concurrent requests with the same key create one invoice", async () => {
      const fic = installFicMock();
      const { apiKey } = await createTenant();
      const responses = await Promise.all([post(apiKey, body()), post(apiKey, body()), post(apiKey, body())]);
      const ids = new Set(await Promise.all(responses.map(async (r) => (await r.json()).id)));
      expect(ids.size).toBe(1);
      expect(await prisma.invoice.count()).toBe(1);
      expect(fic.callsTo(/issued_documents$/)).toHaveLength(1);
    });

    it("FIC failure: row FAILED, 502 with the invoice; repeating the key returns it as is; retry issues it", async () => {
      const fic = installFicMock({ failCreateWith: 422 });
      const { apiKey } = await createTenant();
      const res = await post(apiKey, body());
      expect(res.status).toBe(502);
      const failed = await res.json();
      expect(failed).toMatchObject({ status: "FAILED", error: { code: "fic_error" } });
      expect(failed.errorMessage).toContain("FIC HTTP 422");

      const row = await prisma.invoice.findUniqueOrThrow({ where: { id: failed.id } });
      expect(row.requestPayload).not.toBeNull();

      const again = await post(apiKey, body());
      expect(again.status).toBe(200);
      expect((await again.json()).status).toBe("FAILED");
      expect(fic.callsTo(/issued_documents$/)).toHaveLength(1);

      fic.state.failCreateWith = 0;
      const retried = await retry(apiRequest("/x", { method: "POST", apiKey }), params({ id: failed.id }));
      expect(retried.status).toBe(200);
      expect(await retried.json()).toMatchObject({ status: "ISSUED", attempts: 2, errorMessage: null });

      const notFailed = await retry(apiRequest("/x", { method: "POST", apiKey }), params({ id: failed.id }));
      expect(notFailed.status).toBe(409);
    });

    it("dry run validates with the totals endpoint and never creates a document; caller can force it, not disable it", async () => {
      const fic = installFicMock();
      const live = await createTenant({ dryRun: false, sendToSdi: true });
      const forcedRes = await post(live.apiKey, body({ dryRun: true }));
      expect(forcedRes.status).toBe(201);
      expect(await forcedRes.json()).toMatchObject({
        status: "ISSUED",
        dryRun: true,
        ficDocumentId: null,
        number: null,
        stampDutyCents: 200,
        sdi: { sentAt: null, error: null },
      });

      const dry = await createTenant({ dryRun: true });
      const notOverridden = await (await post(dry.apiKey, body({ dryRun: false }))).json();
      expect(notOverridden).toMatchObject({ status: "ISSUED", dryRun: true, ficDocumentId: null, number: null });

      expect(fic.callsTo(/\/issued_documents\/totals$/)).toHaveLength(2);
      expect(fic.callsTo(/issued_documents$/)).toHaveLength(0);
      expect(fic.callsTo(/\/e_invoice\/send$/)).toHaveLength(0);

      const pdf = await getPdf(apiRequest("/x", { apiKey: dry.apiKey }), params({ id: notOverridden.id }));
      expect(pdf.status).toBe(409);
    });

    it("dry run with a totals mismatch is FAILED", async () => {
      const fic = installFicMock();
      fic.state.amountDueOverride = 50;
      const { apiKey } = await createTenant({ dryRun: true });
      const json = await (await post(apiKey, body())).json();
      expect(json).toMatchObject({ status: "FAILED", dryRun: true });
      expect(json.errorMessage).toMatch(/does not match the amount due/);
      expect(fic.callsTo(/issued_documents$/)).toHaveLength(0);
    });

    it("validation errors: 422 with details; invalid JSON: 400", async () => {
      const { apiKey } = await createTenant();
      const res = await post(apiKey, body({ amountCents: -1 }));
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error.code).toBe("validation_error");
      expect(json.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: "amountCents" })]));

      const bad = await createInvoice(
        apiRequest("/api/v1/invoices", { method: "POST", apiKey, body: "{not json" }),
      );
      expect(bad.status).toBe(400);
      expect(await prisma.invoice.count()).toBe(0);
    });

    it("unconfigured or disconnected tenants are refused before creating a row", async () => {
      installFicMock();
      const unconfigured = await createTenant({ paymentAccountId: null });
      const r1 = await post(unconfigured.apiKey, body());
      expect(r1.status).toBe(409);
      expect((await r1.json()).error.code).toBe("tenant_not_configured");

      const reconnect = await createTenant({ ficNeedsReconnect: true });
      const r2 = await post(reconnect.apiKey, body());
      expect((await r2.json()).error.code).toBe("fic_reconnect_required");
      expect(await prisma.invoice.count()).toBe(0);
    });

    it("sends to SDI when enabled", async () => {
      const fic = installFicMock();
      const { apiKey } = await createTenant({ sendToSdi: true });
      const json = await (await post(apiKey, body())).json();
      expect(json.sdi.sentAt).not.toBeNull();
      expect(fic.callsTo(/\/e_invoice\/send$/)).toHaveLength(1);
    });
  });

  describe("pdf", () => {
    it("streams the courtesy PDF of an issued invoice", async () => {
      const fic = installFicMock();
      const { apiKey } = await createTenant();
      const created = await (await post(apiKey, body())).json();
      const res = await getPdf(apiRequest("/x", { apiKey }), params({ id: created.id }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      const [preview] = fic.callsTo(/preview_url$/, "GET");
      expect(preview.url.searchParams.get("type")).toBe("courtesy_invoice");
      expect(preview.url.searchParams.get("format")).toBe("pdf");
    });
  });
});
