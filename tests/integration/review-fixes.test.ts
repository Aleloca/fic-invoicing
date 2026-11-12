import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createInvoice } from "@/app/api/v1/invoices/route";
import { apiRateLimiter } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { confirmNotInFic, deleteInvoice, invoiceMarker, recoverStalePending, retryInvoice } from "@/lib/invoices/service";
import { prisma } from "@/lib/prisma";
import { createAccount, createProject, hasTestDb, resetDb } from "../helpers/db";
import { installFicMock } from "../helpers/fic-mock";
import { apiRequest } from "../helpers/http";

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

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe.skipIf(!hasTestDb)("code review fixes (integration)", () => {
  beforeEach(async () => {
    await resetDb();
    apiRateLimiter().reset();
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("marks the internal subject of every created document", async () => {
    const fic = installFicMock();
    const { apiKey } = await createProject({ dryRun: false });
    const created = await (await post(apiKey, body())).json();
    const [call] = fic.callsTo(/\/issued_documents$/);
    expect((call.body as { data: { subject: string } }).data.subject).toBe(invoiceMarker(created.id));
  });

  it.each([504, "network"] as const)(
    "a lost answer while creating (%s) is FAILED with an unknown outcome, and retry finds the document instead of creating another",
    async (failure) => {
      const fic = installFicMock({ createSavesThenFails: failure });
      const { project, apiKey } = await createProject({ dryRun: false });
      const created = await (await post(apiKey, body())).json();
      expect(created.status).toBe("FAILED");
      expect(created.outcomeUnknown).toBe(true);
      expect(fic.state.documents.size).toBe(1);

      // Not deletable while the outcome is unknown.
      expect((await rejection(deleteInvoice(project, created.id))).message).toMatch(/may have created/);

      fic.state.createSavesThenFails = 0;
      const retried = await retryInvoice(project, created.id);
      expect(retried.status).toBe("ISSUED");
      expect(retried.ficDocumentId).toBe(5001);
      expect(retried.ficNumber).toBe(created.number ?? "1/T");
      expect(retried.outcomeUnknown).toBe(false);
      // Only the first creation call: no duplicate.
      expect(fic.callsTo(/\/issued_documents$/)).toHaveLength(1);
      expect(fic.state.documents.size).toBe(1);
    },
  );

  it("a definite refusal (4xx) is a plain FAILED that retries straight away", async () => {
    const fic = installFicMock({ failCreateWith: 422 });
    const { project, apiKey } = await createProject({ dryRun: false });
    const created = await (await post(apiKey, body())).json();
    expect(created).toMatchObject({ status: "FAILED", outcomeUnknown: false });
    fic.state.failCreateWith = 0;
    const retried = await retryInvoice(project, created.id);
    expect(retried.status).toBe("ISSUED");
    // No lookup was needed.
    expect(fic.callsTo(/\/issued_documents$/, "GET")).toHaveLength(0);
  });

  it("retries an unknown outcome normally when the document is not in FIC", async () => {
    const fic = installFicMock({ createSavesThenFails: 504 });
    const { project, apiKey } = await createProject({ dryRun: false });
    const created = await (await post(apiKey, body())).json();
    fic.state.documents.clear(); // FIC did not keep it after all
    fic.state.createSavesThenFails = 0;
    const retried = await retryInvoice(project, created.id);
    expect(retried.status).toBe("ISSUED");
    expect(fic.callsTo(/\/issued_documents$/)).toHaveLength(2);
  });

  it("never creates blindly when the lookup fails", async () => {
    const fic = installFicMock({ createSavesThenFails: 504 });
    const { project, apiKey } = await createProject({ dryRun: false });
    const created = await (await post(apiKey, body())).json();
    fic.state.createSavesThenFails = 0;
    // The listing breaks: FIC cannot be asked.
    const original = fic.fetchMock.getMockImplementation()!;
    fic.fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if ((init?.method ?? "GET") === "GET" && /issued_documents$/.test(url.pathname)) {
        return new Response("{}", { status: 503 });
      }
      return original(input, init);
    });
    const error = await rejection(retryInvoice(project, created.id));
    expect(error.status).toBe(502);
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: created.id } });
    expect(row).toMatchObject({ status: "FAILED", outcomeUnknown: true });
    expect(fic.callsTo(/\/issued_documents$/)).toHaveLength(1);
  });

  it("the admin can confirm an unknown outcome is not in FIC, then delete it", async () => {
    installFicMock({ createSavesThenFails: 504 });
    const { project, apiKey } = await createProject({ dryRun: false });
    const created = await (await post(apiKey, body())).json();
    await confirmNotInFic({ projectId: project.id }, created.id);
    const deleted = await deleteInvoice(project, created.id);
    expect(deleted.status).toBe("DELETED");
  });

  it("releases invoices left PENDING by a stopped process", async () => {
    installFicMock();
    const { project } = await createProject({ dryRun: false });
    const old = new Date(Date.now() - 20 * 60 * 1000);
    const base = { projectId: project.id, customerCategory: "IT_PRIVATE" as const, amountCents: 100, description: "x", dryRun: false };
    const issuing = await prisma.invoice.create({ data: { ...base, idempotencyKey: "a", status: "PENDING" } });
    const deleting = await prisma.invoice.create({
      data: { ...base, idempotencyKey: "b", status: "PENDING", errorMessage: "deleting:ISSUED", ficDocumentId: 9 },
    });
    const fresh = await prisma.invoice.create({ data: { ...base, idempotencyKey: "c", status: "PENDING" } });
    await prisma.$executeRaw`UPDATE invoices SET updatedAt = ${old} WHERE id IN (${issuing.id}, ${deleting.id})`;

    expect(await recoverStalePending()).toBe(2);
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: issuing.id } })).toMatchObject({
      status: "FAILED",
      outcomeUnknown: true,
    });
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: deleting.id } })).toMatchObject({
      status: "ISSUED",
      errorMessage: null,
    });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("PENDING");
  });

  it("a delete claims the row: a retry starting meanwhile is refused", async () => {
    const fic = installFicMock({ failCreateWith: 422 });
    const { project, apiKey } = await createProject({ dryRun: false });
    const created = await (await post(apiKey, body())).json();
    fic.state.failCreateWith = 0;
    // Simulate the delete holding the row.
    await prisma.invoice.update({ where: { id: created.id }, data: { status: "PENDING", errorMessage: "deleting:FAILED" } });
    expect((await rejection(retryInvoice(project, created.id))).status).toBe(409);
    expect((await rejection(deleteInvoice(project, created.id))).status).toBe(409);
  });

  it("merging duplicate accounts moves the Apple accounts of a merged company", async () => {
    const { mergeAccountForTests } = await import("@/lib/projects/accounts");
    const from = await createAccount();
    const into = await createAccount();
    const company = await prisma.company.create({ data: { accountId: from.id, ficCompanyId: 77, name: "Same" } });
    const twin = await prisma.company.create({ data: { accountId: into.id, ficCompanyId: 77, name: "Same" } });
    const apple = await prisma.appleAccount.create({
      data: { label: "A", issuerId: "i", keyId: "k", privateKeyEnc: "x", vendorNumber: "1", companyId: company.id, customer: {}, nextPeriod: "2027-01" },
    });
    await mergeAccountForTests(from, into);
    expect((await prisma.appleAccount.findUniqueOrThrow({ where: { id: apple.id } })).companyId).toBe(twin.id);
  });
});
