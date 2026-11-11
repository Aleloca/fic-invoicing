import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getInvoice } from "@/app/api/v1/invoices/[id]/route";
import { GET as getPdf } from "@/app/api/v1/invoices/[id]/pdf/route";
import { POST as retry } from "@/app/api/v1/invoices/[id]/retry/route";
import { POST as createInvoice } from "@/app/api/v1/invoices/route";
import { apiRateLimiter } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { deleteInvoice } from "@/lib/invoices/service";
import { prisma } from "@/lib/prisma";
import { createTenant, hasTestDb, resetDb } from "../helpers/db";
import { installFicMock } from "../helpers/fic-mock";
import { apiRequest, params } from "../helpers/http";

const body = (overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: "order-1",
  amountCents: 5000,
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

const post = (apiKey: string, payload: unknown) =>
  createInvoice(apiRequest("/api/v1/invoices", { method: "POST", apiKey, body: payload }));

async function expectConflict(promise: Promise<unknown>, message: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(409);
  expect((error as ApiError).message).toMatch(message);
}

describe.skipIf(!hasTestDb)("invoice deletion (integration)", () => {
  beforeEach(async () => {
    await resetDb();
    apiRateLimiter().reset();
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("deletes the FIC document and keeps the row as DELETED, with number and document id", async () => {
    const fic = installFicMock();
    const { tenant, apiKey } = await createTenant();
    const created = await (await post(apiKey, body())).json();
    expect(created).toMatchObject({ status: "ISSUED", ficDocumentId: 5001, number: "1/T", deletedAt: null });

    const deleted = await deleteInvoice(tenant, created.id);
    expect(deleted).toMatchObject({ status: "DELETED", ficDocumentId: 5001, ficNumber: "1/T" });
    expect(deleted.deletedAt).toBeInstanceOf(Date);

    const [call] = fic.callsTo(new RegExp(`^/c/${tenant.ficCompanyId}/issued_documents/5001$`), "DELETE");
    expect(call.authorization).toBe("Bearer access-0");
    expect(fic.state.documents.has(5001)).toBe(false);

    // Public API: GET shows DELETED, PDF is refused, retry is refused.
    const got = await getInvoice(apiRequest("/x", { apiKey }), params({ id: created.id }));
    expect(await got.json()).toMatchObject({ status: "DELETED", number: "1/T", deletedAt: expect.any(String) });
    const pdf = await getPdf(apiRequest("/x", { apiKey }), params({ id: created.id }));
    expect(pdf.status).toBe(409);
    expect(fic.callsTo(/preview_url$/, "GET")).toHaveLength(0);
    const retried = await retry(apiRequest("/x", { method: "POST", apiKey }), params({ id: created.id }));
    expect(retried.status).toBe(409);
    expect((await retried.json()).error.code).toBe("conflict");

    // Deleting again is a no-op.
    expect((await deleteInvoice(tenant, created.id)).status).toBe("DELETED");
    expect(fic.callsTo(/issued_documents\/\d+$/, "DELETE")).toHaveLength(1);
  });

  it("a later POST with the same idempotency key returns the invoice with status DELETED", async () => {
    const fic = installFicMock();
    const { tenant, apiKey } = await createTenant();
    const created = await (await post(apiKey, body())).json();
    await deleteInvoice(tenant, created.id);

    const again = await post(apiKey, body());
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ id: created.id, status: "DELETED" });
    expect(fic.callsTo(/issued_documents$/)).toHaveLength(1);
  });

  it("a 404 from FIC counts as already deleted", async () => {
    const fic = installFicMock();
    const { tenant, apiKey } = await createTenant();
    const created = await (await post(apiKey, body())).json();
    fic.state.documents.clear();

    const deleted = await deleteInvoice(tenant, created.id);
    expect(deleted.status).toBe("DELETED");
    expect(fic.callsTo(/issued_documents\/5001$/, "DELETE")).toHaveLength(1);
  });

  it("refuses invoices already sent to SDI", async () => {
    const fic = installFicMock();
    const { tenant, apiKey } = await createTenant({ sendToSdi: true });
    const created = await (await post(apiKey, body())).json();
    expect(created.sdi.sentAt).not.toBeNull();

    await expectConflict(deleteInvoice(tenant, created.id), /sent to SDI/);
    expect(fic.callsTo(/issued_documents\/\d+$/, "DELETE")).toHaveLength(0);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("ISSUED");
  });

  it("refuses invoices without a FIC document (dry run, failed)", async () => {
    const fic = installFicMock();
    const dry = await createTenant({ dryRun: true });
    const dryInvoice = await (await post(dry.apiKey, body())).json();
    expect(dryInvoice).toMatchObject({ status: "ISSUED", ficDocumentId: null });
    await expectConflict(deleteInvoice(dry.tenant, dryInvoice.id), /document in Fatture in Cloud/);

    fic.state.failCreateWith = 422;
    const live = await createTenant();
    const failed = await (await post(live.apiKey, body())).json();
    expect(failed.status).toBe("FAILED");
    await expectConflict(deleteInvoice(live.tenant, failed.id), /document in Fatture in Cloud/);

    expect(fic.callsTo(/issued_documents\/\d+$/, "DELETE")).toHaveLength(0);
  });

  it("does not delete another tenant's invoice", async () => {
    installFicMock();
    const a = await createTenant();
    const b = await createTenant();
    const created = await (await post(a.apiKey, body())).json();
    const error = await deleteInvoice(b.tenant, created.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
  });
});
