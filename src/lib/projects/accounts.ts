/**
 * Fatture in Cloud accounts and companies: connecting, matching the same FIC user, and
 * creating a company row the first time a project picks it.
 */
import type { Company, FicAccount } from "@prisma/client";
import { getUserInfo, type FicCompany, type FicTokenResponse, type FicUserInfo } from "../fic/client";
import { getFicAccess, tokenFields } from "../fic/tokens";
import { prisma } from "../prisma";

/** The user behind an account's tokens, or null when FIC cannot tell (or the account is unusable). */
async function userOf(account: FicAccount): Promise<FicUserInfo | null> {
  try {
    return await getUserInfo(await getFicAccess(account.id));
  } catch {
    return null;
  }
}

/** Moves everything of `from` into `into` (same FIC user) and deletes `from`. */
async function mergeAccount(from: FicAccount, into: FicAccount): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const companies = await tx.company.findMany({ where: { accountId: from.id } });
    for (const company of companies) {
      const twin = await tx.company.findUnique({
        where: { accountId_ficCompanyId: { accountId: into.id, ficCompanyId: company.ficCompanyId } },
      });
      if (!twin) {
        await tx.company.update({ where: { id: company.id }, data: { accountId: into.id } });
        continue;
      }
      // The same FIC company on both: keep the twin and its defaults, move projects and invoices.
      await tx.project.updateMany({ where: { companyId: company.id }, data: { companyId: twin.id } });
      await tx.invoice.updateMany({ where: { companyId: company.id }, data: { companyId: twin.id } });
      await tx.company.delete({ where: { id: company.id } });
    }
    await tx.ficAccount.delete({ where: { id: from.id } });
  });
}

/**
 * Accounts migrated from tenants do not know their FIC user. Asks FIC once for each and either
 * records the user or, when another account already belongs to that user, merges them: one FIC
 * user is one account here, so its companies are listed once.
 */
export async function consolidateAccounts(): Promise<void> {
  const unknown = await prisma.ficAccount.findMany({
    where: { ficUserId: null, needsReconnect: false, refreshTokenEnc: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  for (const account of unknown) {
    const owner = await userOf(account);
    if (!owner) continue;
    try {
      const existing = await prisma.ficAccount.findUnique({ where: { ficUserId: owner.id } });
      if (existing) await mergeAccount(account, existing);
      else {
        await prisma.ficAccount.updateMany({
          where: { id: account.id, ficUserId: null },
          data: { ficUserId: owner.id, ficUserEmail: owner.email, label: owner.name },
        });
      }
    } catch (error) {
      // A concurrent request did the same work: nothing to do.
      console.warn("[fic-invoicing] could not consolidate account", account.id, error instanceof Error ? error.message : error);
    }
  }
}

/** The account already connected for this FIC user, if any. */
async function findAccountOf(user: FicUserInfo): Promise<FicAccount | null> {
  await consolidateAccounts();
  return prisma.ficAccount.findUnique({ where: { ficUserId: user.id } });
}

export type ConnectResult =
  { ok: true; account: FicAccount; created: boolean } | { ok: false; reason: "unknown_account" | "different_user" };

/**
 * Stores tokens from the OAuth callback. With `accountId` it reconnects that account (refusing a
 * different FIC user, whose companies would not match); otherwise it updates the account of the
 * same FIC user or creates a new one.
 */
export async function connectAccount(
  tokens: FicTokenResponse,
  user: FicUserInfo | null,
  accountId?: string,
): Promise<ConnectResult> {
  const fields = tokenFields(tokens);
  const identity = user ? { ficUserId: user.id, ficUserEmail: user.email } : {};

  if (accountId) {
    const account = await prisma.ficAccount.findUnique({ where: { id: accountId } });
    if (!account) return { ok: false, reason: "unknown_account" };
    if (user && account.ficUserId !== null && account.ficUserId !== user.id)
      return { ok: false, reason: "different_user" };
    if (user && account.ficUserId === null) {
      const other = await prisma.ficAccount.findUnique({ where: { ficUserId: user.id } });
      if (other && other.id !== account.id) return { ok: false, reason: "different_user" };
    }
    const updated = await prisma.ficAccount.update({ where: { id: account.id }, data: { ...fields, ...identity } });
    return { ok: true, account: updated, created: false };
  }

  const existing = user ? await findAccountOf(user) : null;
  if (existing) {
    const updated = await prisma.ficAccount.update({ where: { id: existing.id }, data: { ...fields, ...identity } });
    return { ok: true, account: updated, created: false };
  }
  const created = await prisma.ficAccount.create({
    data: { label: user?.name ?? "Fatture in Cloud account", ...fields, ...identity },
  });
  return { ok: true, account: created, created: true };
}

/** The company row for a FIC company of an account, created on first use (name kept up to date). */
export function ensureCompany(accountId: string, company: FicCompany): Promise<Company> {
  return prisma.company.upsert({
    where: { accountId_ficCompanyId: { accountId, ficCompanyId: company.id } },
    create: { accountId, ficCompanyId: company.id, name: company.name },
    update: { name: company.name },
  });
}
