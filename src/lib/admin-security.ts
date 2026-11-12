/**
 * Second factor of the admin panel: authenticator app (TOTP), passkeys and one-time recovery codes.
 * Once a factor exists, every sign-in needs the password and one of them.
 */
import { randomBytes } from "node:crypto";
import type { AdminSecurity, Prisma } from "@prisma/client";
import { decrypt, encrypt, sha256Hex } from "./crypto";
import { prisma } from "./prisma";
import { base32Encode, generateTotpSecret, matchTotp, otpauthUri } from "./totp";

const ID = 1;
export const RECOVERY_CODE_COUNT = 10;

interface RecoveryCode {
  hash: string;
  usedAt: string | null;
}

export async function readSecurity(): Promise<AdminSecurity | null> {
  return prisma.adminSecurity.findUnique({ where: { id: ID } });
}

function ensure(): Promise<AdminSecurity> {
  return prisma.adminSecurity.upsert({ where: { id: ID }, create: { id: ID }, update: {} });
}

export async function sessionVersion(): Promise<number> {
  return (await readSecurity())?.sessionVersion ?? 1;
}

/** Signs out every other session: their cookies carry the old version. */
export async function bumpSessionVersion(): Promise<number> {
  await ensure();
  const row = await prisma.adminSecurity.update({ where: { id: ID }, data: { sessionVersion: { increment: 1 } } });
  return row.sessionVersion;
}

function codesOf(row: AdminSecurity | null): RecoveryCode[] {
  return Array.isArray(row?.recoveryCodes) ? (row.recoveryCodes as unknown as RecoveryCode[]) : [];
}

export interface FactorState {
  totp: boolean;
  passkeys: number;
  recoveryLeft: number;
  /** True when sign-in asks for a second factor. */
  enabled: boolean;
}

export async function factorState(): Promise<FactorState> {
  const [row, passkeys] = await Promise.all([readSecurity(), prisma.adminPasskey.count()]);
  const totp = Boolean(row?.totpSecretEnc);
  return {
    totp,
    passkeys,
    recoveryLeft: codesOf(row).filter((c) => !c.usedAt).length,
    enabled: totp || passkeys > 0,
  };
}

// ----------------------------------------------------------------- Recovery codes

function normalizeRecovery(code: string): string {
  return code.toLowerCase().replace(/[^a-z2-7]/g, "");
}

/** Replaces the recovery codes with new ones, returned in clear once. */
export async function generateRecoveryCodes(): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  const stored: RecoveryCode[] = codes.map((c) => ({ hash: sha256Hex(normalizeRecovery(c)), usedAt: null }));
  await ensure();
  await prisma.adminSecurity.update({
    where: { id: ID },
    data: { recoveryCodes: stored as unknown as Prisma.InputJsonValue },
  });
  return codes;
}

/** Spends a recovery code. Returns false when it is unknown or used. */
export async function spendRecoveryCode(code: string, now: Date = new Date()): Promise<boolean> {
  const hash = sha256Hex(normalizeRecovery(code));
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM admin_security WHERE id = ${ID} FOR UPDATE`;
    if (rows.length === 0) return false;
    const row = await tx.adminSecurity.findUniqueOrThrow({ where: { id: ID } });
    const codes = codesOf(row);
    const match = codes.find((c) => c.hash === hash && !c.usedAt);
    if (!match) return false;
    match.usedAt = now.toISOString();
    await tx.adminSecurity.update({ where: { id: ID }, data: { recoveryCodes: codes as unknown as Prisma.InputJsonValue } });
    return true;
  });
}

/** Called after a factor is added: the first factor comes with recovery codes. */
async function codesForFirstFactor(): Promise<string[] | null> {
  return codesOf(await readSecurity()).length === 0 ? generateRecoveryCodes() : null;
}

/** Called after a factor is removed: with none left, 2FA is off and the codes go too. */
export async function afterFactorRemoved(): Promise<void> {
  const state = await factorState();
  if (!state.enabled) await prisma.adminSecurity.update({ where: { id: ID }, data: { recoveryCodes: [] } });
}

// --------------------------------------------------------------------- TOTP

export const TOTP_ISSUER = "fic-invoicing";

export interface PendingTotp {
  secret: string;
  uri: string;
}

export async function pendingTotp(): Promise<PendingTotp | null> {
  const row = await readSecurity();
  if (!row?.totpPendingEnc) return null;
  const secret = decrypt(row.totpPendingEnc);
  return { secret, uri: otpauthUri(secret, "admin", TOTP_ISSUER) };
}

export async function startTotpSetup(): Promise<void> {
  await ensure();
  await prisma.adminSecurity.update({ where: { id: ID }, data: { totpPendingEnc: encrypt(generateTotpSecret()) } });
}

export async function cancelTotpSetup(): Promise<void> {
  await prisma.adminSecurity.updateMany({ where: { id: ID }, data: { totpPendingEnc: null } });
}

/** Confirms the pending secret with a code from the app. Returns null on a wrong code. */
export async function confirmTotp(code: string, now: number = Date.now()): Promise<{ recoveryCodes: string[] | null } | null> {
  const pending = await pendingTotp();
  if (!pending) return null;
  const step = matchTotp(pending.secret, code, now);
  if (step === null) return null;
  await prisma.adminSecurity.update({
    where: { id: ID },
    data: { totpSecretEnc: encrypt(pending.secret), totpPendingEnc: null, totpLastStep: step },
  });
  return { recoveryCodes: await codesForFirstFactor() };
}

export async function disableTotp(): Promise<void> {
  await prisma.adminSecurity.updateMany({
    where: { id: ID },
    data: { totpSecretEnc: null, totpPendingEnc: null, totpLastStep: null },
  });
  await afterFactorRemoved();
}

/** Checks a code from the app. Each code is accepted once. */
export async function verifyTotp(code: string, now: number = Date.now()): Promise<boolean> {
  const row = await readSecurity();
  if (!row?.totpSecretEnc) return false;
  const step = matchTotp(decrypt(row.totpSecretEnc), code, now);
  if (step === null) return false;
  // Conditional update: two requests with the same code cannot both pass.
  const { count } = await prisma.adminSecurity.updateMany({
    where: { id: ID, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  });
  return count === 1;
}

/** After a passkey is added. */
export async function afterPasskeyAdded(): Promise<string[] | null> {
  return codesForFirstFactor();
}
