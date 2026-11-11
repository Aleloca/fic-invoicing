import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as oauthCallback } from "@/app/api/oauth/fic/callback/route";
import { POST as createInvoice } from "@/app/api/v1/invoices/route";
import { apiRateLimiter } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { deleteInvoice } from "@/lib/invoices/service";
import { consolidateAccounts } from "@/lib/projects/accounts";
import { createOAuthState, type OAuthTarget } from "@/lib/oauth-state";
import { prisma } from "@/lib/prisma";
import { PROJECT_INCLUDE } from "@/lib/projects/config";
import { generateApiKey } from "@/lib/api-key";
import { createAccount, createProject, hasTestDb, resetDb } from "../helpers/db";
import { installFicMock } from "../helpers/fic-mock";
import { apiRequest } from "../helpers/http";

vi.mock("@/lib/admin-session", () => ({ isAdmin: async () => true, requireAdmin: async () => undefined }));

const body = (idempotencyKey: string) => ({
  idempotencyKey,
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
});

const post = (apiKey: string, key: string) =>
  createInvoice(apiRequest("/api/v1/invoices", { method: "POST", apiKey, body: body(key) }));

async function callback(target: OAuthTarget, code = "c1"): Promise<string> {
  const state = createOAuthState(target);
  const res = await oauthCallback(
    new Request(`http://localhost:3000/api/oauth/fic/callback?code=${code}&state=${encodeURIComponent(state)}`),
  );
  expect(res.status).toBe(303);
  return new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search;
}

async function bareProject() {
  const key = generateApiKey();
  return prisma.project.create({
    data: { name: "New app", slug: `new-app-${Date.now()}`, apiKeyHash: key.hash, apiKeyPrefix: key.displayPrefix },
  });
}

interface SentDocument {
  data: { numeration?: string; items_list: { code: string }[] };
}

describe.skipIf(!hasTestDb)("accounts, companies and projects (integration)", () => {
  beforeEach(async () => {
    await resetDb();
    apiRateLimiter().reset();
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  describe("connecting Fatture in Cloud", () => {
    it("a project without company gets the only company of a newly connected account", async () => {
      installFicMock({
        user: { id: 7, name: "Mario Rossi", email: "m@example.com" },
        companies: [{ id: 4242, name: "ACME srl" }],
      });
      const project = await bareProject();

      expect(await callback({ projectId: project.id })).toBe(`/admin/projects/${project.id}?notice=connected`);

      const account = await prisma.ficAccount.findFirstOrThrow({ include: { companies: true } });
      expect(account).toMatchObject({
        label: "Mario Rossi",
        ficUserId: 7,
        ficUserEmail: "m@example.com",
        needsReconnect: false,
      });
      expect(decrypt(account.refreshTokenEnc!)).toBe("refresh-code-c1");
      expect(account.companies).toHaveLength(1);
      const fresh = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      expect(fresh.companyId).toBe(account.companies[0].id);
    });

    it("with several companies the admin is sent to choose one", async () => {
      installFicMock({
        companies: [
          { id: 1, name: "A" },
          { id: 2, name: "B" },
        ],
      });
      const project = await bareProject();
      const location = await callback({ projectId: project.id });
      const account = await prisma.ficAccount.findFirstOrThrow();
      expect(location).toBe(`/admin/projects/${project.id}/company?account=${account.id}`);
      expect(await prisma.company.count()).toBe(0);
    });

    it("connecting the same FIC user again updates its account instead of adding one", async () => {
      installFicMock({ user: { id: 7, name: "Mario", email: "m@example.com" } });
      await callback({}, "first");
      expect(await callback({}, "second")).toBe("/admin/fic?notice=reconnected");
      const accounts = await prisma.ficAccount.findMany();
      expect(accounts).toHaveLength(1);
      expect(decrypt(accounts[0].refreshTokenEnc!)).toBe("refresh-code-second");
    });

    it("an account migrated without a FIC user id is recognised and backfilled", async () => {
      installFicMock({ user: { id: 7, name: "Mario", email: "m@example.com" }, validRefreshToken: "refresh-0" });
      const migrated = await createAccount();
      expect(migrated.ficUserId).toBeNull();

      await callback({}, "again");

      const accounts = await prisma.ficAccount.findMany();
      expect(accounts.map((a) => a.id)).toEqual([migrated.id]);
      expect(accounts[0].ficUserId).toBe(7);
      expect(decrypt(accounts[0].refreshTokenEnc!)).toBe("refresh-code-again");
    });

    it("migrated accounts of one FIC user are merged, twin companies included", async () => {
      installFicMock({ user: { id: 7, name: "Giulia Rami", email: "g@example.com" } });
      const first = await createProject({ account: await createAccount({ refresh: "r1" }) });
      const second = await createProject({ account: await createAccount({ refresh: "r2" }) });
      // A third tenant had connected on its own to the first one's FIC company.
      const thirdAccount = await createAccount({ refresh: "r3" });
      const twin = await prisma.company.create({
        data: { accountId: thirdAccount.id, ficCompanyId: first.project.company!.ficCompanyId, name: "Twin" },
      });
      const third = await createProject({ account: thirdAccount, companyId: twin.id });

      await consolidateAccounts();

      const accounts = await prisma.ficAccount.findMany({ include: { companies: true } });
      expect(accounts).toHaveLength(1);
      expect(accounts[0]).toMatchObject({ id: first.project.company!.accountId, ficUserId: 7, label: "Giulia Rami" });
      expect(accounts[0].companies.map((c) => c.id).sort()).toEqual(
        [first.project.companyId!, second.project.companyId!].sort(),
      );
      const moved = await prisma.project.findUniqueOrThrow({ where: { id: third.project.id } });
      expect(moved.companyId).toBe(first.project.companyId);
    });

    it("reconnecting clears the reconnect flag for every project of the account", async () => {
      installFicMock({ user: { id: 7, name: "Mario", email: "m@example.com" } });
      const account = await createAccount({}, { needsReconnect: true, ficUserId: 7, lastError: "rejected" });
      const { apiKey } = await createProject({ account });
      expect((await post(apiKey, "before")).status).toBe(409);

      expect(await callback({ accountId: account.id })).toBe("/admin/fic?notice=reconnected");
      const row = await prisma.ficAccount.findUniqueOrThrow({ where: { id: account.id } });
      expect(row).toMatchObject({ needsReconnect: false, lastError: null });
      expect((await post(apiKey, "after")).status).toBe(201);
    });

    it("refuses to reconnect an account with a different FIC user", async () => {
      installFicMock({ user: { id: 8, name: "Someone else", email: "x@example.com" } });
      const account = await createAccount({ refresh: "keep-me" }, { ficUserId: 7 });
      expect(await callback({ accountId: account.id })).toBe("/admin/fic?error=oauth_different_user");
      const row = await prisma.ficAccount.findUniqueOrThrow({ where: { id: account.id } });
      expect(decrypt(row.refreshTokenEnc!)).toBe("keep-me");
    });
  });

  describe("inherited settings", () => {
    it("projects on one company inherit its defaults and apply their own overrides", async () => {
      const fic = installFicMock();
      const first = await createProject({ numeration: "/A", itemCode: "SHOP", sendToSdi: true });
      const second = await createProject({
        account: first.project.company!.account,
        companyId: first.project.companyId!,
        overrides: { numeration: "/B", itemCode: "", sendToSdi: false },
      });

      expect((await post(first.apiKey, "one")).status).toBe(201);
      expect((await post(second.apiKey, "two")).status).toBe(201);

      const created = fic.callsTo(/^\/c\/\d+\/issued_documents$/).map((c) => (c.body as SentDocument).data);
      expect(created.map((d) => d.numeration)).toEqual(["/A", "/B"]);
      expect(created.map((d) => d.items_list[0].code)).toEqual(["SHOP", ""]);
      // Only the first project sends to SDI: the second overrides the company default.
      expect(fic.callsTo(/\/e_invoice\/send$/)).toHaveLength(1);

      const invoices = await prisma.invoice.findMany({ orderBy: { createdAt: "asc" } });
      expect(invoices.map((i) => i.ficNumber)).toEqual(["1/A", "2/B"]);
      expect(new Set(invoices.map((i) => i.companyId))).toEqual(new Set([first.project.companyId]));
    });

    it("a change to the company default reaches every project that follows it", async () => {
      const fic = installFicMock();
      const { project, apiKey } = await createProject({ numeration: "/A" });
      await prisma.company.update({ where: { id: project.companyId! }, data: { numeration: "/Z" } });
      expect((await post(apiKey, "one")).status).toBe(201);
      const [call] = fic.callsTo(/^\/c\/\d+\/issued_documents$/);
      expect((call.body as SentDocument).data.numeration).toBe("/Z");
    });

    it("an invoice is deleted from the company that issued it, even after the project moved", async () => {
      const fic = installFicMock();
      const { project, apiKey } = await createProject();
      const created = await (await post(apiKey, "one")).json();
      const oldCompany = project.company!.ficCompanyId;

      const other = await createProject({ account: project.company!.account });
      await prisma.project.update({ where: { id: project.id }, data: { companyId: other.project.companyId } });
      const moved = await prisma.project.findUniqueOrThrow({ where: { id: project.id }, include: PROJECT_INCLUDE });

      expect((await deleteInvoice(moved, created.id)).status).toBe("DELETED");
      const [call] = fic.callsTo(/\/issued_documents\/\d+$/, "DELETE");
      expect(call.url.pathname).toBe(`/c/${oldCompany}/issued_documents/5001`);
    });
  });
});
