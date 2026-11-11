import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createInvoice } from "@/app/api/v1/invoices/route";
import { decrypt } from "@/lib/crypto";
import { getFicAccess } from "@/lib/fic/tokens";
import { prisma } from "@/lib/prisma";
import { createAccount, createProject, hasTestDb, resetDb } from "../helpers/db";
import { installFicMock } from "../helpers/fic-mock";
import { apiRequest } from "../helpers/http";

const invoiceBody = (idempotencyKey: string) => ({
  idempotencyKey,
  amountCents: 100,
  description: "x",
  customer: {
    category: "EXTRAEU_PRIVATE",
    firstName: "A",
    lastName: "B",
    address: "1 St",
    zipCode: "10001",
    city: "NYC",
    countryCode: "US",
    email: "a@example.com",
  },
});

const post = (apiKey: string, key: string) =>
  createInvoice(apiRequest("/api/v1/invoices", { method: "POST", apiKey, body: invoiceBody(key) }));

describe.skipIf(!hasTestDb)("FIC token refresh (integration)", () => {
  beforeEach(resetDb);
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it("does not refresh a token that is valid for more than 5 minutes", async () => {
    const fic = installFicMock();
    const account = await createAccount({ expiresInMs: 10 * 60 * 1000 });
    expect(await getFicAccess(account.id)).toBe("access-0");
    expect(fic.state.refreshCount).toBe(0);
  });

  it("refreshes when less than 5 minutes remain and stores the rotated tokens encrypted", async () => {
    const fic = installFicMock();
    const account = await createAccount({ expiresInMs: 4 * 60 * 1000 });
    expect(await getFicAccess(account.id)).toBe("access-1");
    const row = await prisma.ficAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(decrypt(row.refreshTokenEnc!)).toBe("refresh-1");
    expect(row.refreshTokenEnc).not.toContain("refresh-1");
    expect(row.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(fic.state.refreshCount).toBe(1);
  });

  it("serializes concurrent refreshes: one call to FIC, everyone gets the new token", async () => {
    // A slow FIC that rejects an already-rotated refresh token, like the real one.
    const fic = installFicMock({ refreshDelayMs: 150 });
    const account = await createAccount({ expiresInMs: -1000 });

    const results = await Promise.all(Array.from({ length: 6 }, () => getFicAccess(account.id)));

    expect(fic.state.refreshCount).toBe(1);
    expect(new Set(results)).toEqual(new Set(["access-1"]));
    const row = await prisma.ficAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.needsReconnect).toBe(false);
    expect(decrypt(row.refreshTokenEnc!)).toBe("refresh-1");
  });

  it("projects on different companies of one account share its token chain", async () => {
    const fic = installFicMock({ refreshDelayMs: 100 });
    const account = await createAccount({ expiresInMs: -1000 });
    const a = await createProject({ account });
    const b = await createProject({ account });
    expect(a.project.companyId).not.toBe(b.project.companyId);

    const [ra, rb] = await Promise.all([post(a.apiKey, "a-1"), post(b.apiKey, "b-1")]);
    expect(ra.status).toBe(201);
    expect(rb.status).toBe(201);
    // One refresh for both: a second one would have used the rotated-away token and failed.
    expect(fic.state.refreshCount).toBe(1);
    const row = await prisma.ficAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.needsReconnect).toBe(false);
  });

  it("flags the account when FIC rejects the refresh token: every project of it is refused", async () => {
    installFicMock({ validRefreshToken: "something-else" });
    const account = await createAccount({ expiresInMs: -1000 });
    const a = await createProject({ account });
    const b = await createProject({ account, companyId: a.project.companyId! });

    await expect(getFicAccess(account.id)).rejects.toMatchObject({ code: "fic_reconnect_required" });
    const row = await prisma.ficAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.needsReconnect).toBe(true);
    expect(row.lastError).toContain("invalid_grant");

    for (const apiKey of [a.apiKey, b.apiKey]) {
      const res = await post(apiKey, "k");
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe("fic_reconnect_required");
    }
  });

  it("transient FIC errors do not flag the account", async () => {
    const fic = installFicMock();
    fic.fetchMock.mockImplementationOnce(async () => new Response("upstream down", { status: 503 }));
    const account = await createAccount({ expiresInMs: -1000 });
    await expect(getFicAccess(account.id)).rejects.toMatchObject({ status: 503 });
    const row = await prisma.ficAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.needsReconnect).toBe(false);
    expect(decrypt(row.refreshTokenEnc!)).toBe("refresh-0");
  });
});
