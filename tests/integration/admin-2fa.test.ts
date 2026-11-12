import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// A cookie jar standing in for next/headers.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

const security = await import("@/lib/admin-security");
const session = await import("@/lib/admin-session");
const { loginAction } = await import("@/app/admin/actions");
const { verifyCodeAction } = await import("@/app/admin/security-actions");
const { totpCode } = await import("@/lib/totp");
const { prisma } = await import("@/lib/prisma");
const { hasTestDb, resetDb } = await import("../helpers/db");

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

async function redirectOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    const match = /^REDIRECT (.+)$/.exec(error instanceof Error ? error.message : "");
    if (!match) throw error;
    return match[1];
  }
}

/** Turns the authenticator app on and returns its secret and the recovery codes. */
async function enableTotp(now = Date.now()) {
  await security.startTotpSetup();
  const pending = (await security.pendingTotp())!;
  const result = await security.confirmTotp(totpCode(pending.secret, now), now);
  return { secret: pending.secret, codes: result!.recoveryCodes! };
}

describe.skipIf(!hasTestDb)("admin two-factor sign-in", () => {
  beforeEach(async () => {
    jar.clear();
    await resetDb();
  });
  afterAll(() => prisma.$disconnect());

  it("signs in with the password alone while no factor exists", async () => {
    expect((await security.factorState()).enabled).toBe(false);
    expect(await redirectOf(loginAction({}, form({ password: "test-admin-password" })))).toBe("/admin");
    expect(await session.isAdmin()).toBe(true);
  });

  it("turns the authenticator app on with a confirmed code and makes recovery codes", async () => {
    await security.startTotpSetup();
    expect(await security.confirmTotp("000000")).toBeNull();
    const { codes } = await enableTotp();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(await security.factorState()).toEqual({ totp: true, passkeys: 0, recoveryLeft: 10, enabled: true });
  });

  it("asks for the code after the password and accepts each code once", async () => {
    const now = Date.now();
    const { secret } = await enableTotp(now - 60_000);

    expect(await redirectOf(loginAction({}, form({ password: "test-admin-password" })))).toBe("/admin/login/verify");
    expect(await session.isAdmin()).toBe(false);
    expect(await session.hasPendingSession()).toBe(true);

    expect(await verifyCodeAction({}, form({ method: "totp", code: "000000" }))).toEqual({ error: "Wrong or expired code." });
    const code = totpCode(secret);
    expect(await redirectOf(verifyCodeAction({}, form({ method: "totp", code })))).toBe("/admin");
    expect(await session.isAdmin()).toBe(true);
    // The same code cannot be replayed.
    expect(await security.verifyTotp(code)).toBe(false);
  });

  it("refuses the second step without the password first", async () => {
    await enableTotp();
    expect(await redirectOf(verifyCodeAction({}, form({ method: "totp", code: "123456" })))).toBe("/admin/login");
  });

  it("spends recovery codes once, ignoring case and dashes", async () => {
    const { codes } = await enableTotp();
    expect(await security.spendRecoveryCode(codes[0].toUpperCase().replace("-", " "))).toBe(true);
    expect(await security.spendRecoveryCode(codes[0])).toBe(false);
    expect(await security.spendRecoveryCode("aaaaa-bbbbb")).toBe(false);
    expect((await security.factorState()).recoveryLeft).toBe(9);

    await session.createPendingSession();
    expect(await redirectOf(verifyCodeAction({}, form({ method: "recovery", code: codes[1] })))).toBe(
      "/admin/security?notice=recovery_used",
    );
    expect(await session.isAdmin()).toBe(true);
  });

  it("signs out other sessions when the factors change", async () => {
    await session.createAdminSession();
    const before = jar.get("fici_admin")!;
    expect(await session.isAdmin()).toBe(true);
    await security.bumpSessionVersion();
    expect(await session.isAdmin()).toBe(false);
    await session.createAdminSession();
    expect(jar.get("fici_admin")).not.toBe(before);
    expect(await session.isAdmin()).toBe(true);
  });

  it("removing the last factor turns 2FA off and drops the recovery codes", async () => {
    await enableTotp();
    await security.disableTotp();
    expect(await security.factorState()).toEqual({ totp: false, passkeys: 0, recoveryLeft: 0, enabled: false });
  });

  it("keeps 2FA on while a passkey remains", async () => {
    await enableTotp();
    await prisma.adminPasskey.create({ data: { credentialId: "cred", publicKey: Buffer.from([1]), name: "Mac" } });
    await security.disableTotp();
    expect(await security.factorState()).toEqual({ totp: false, passkeys: 1, recoveryLeft: 10, enabled: true });
  });
});
