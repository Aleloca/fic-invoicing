/**
 * Looks for new App Store financial reports and stores them with a euro estimate.
 */
import type { AppleAccount, Prisma } from "@prisma/client";
import { syncApps } from "./apps";
import { credentialsOf } from "./credentials";
import { todayInItaly } from "../fiscal/payload";
import { prisma } from "../prisma";
import { lastEndedPeriod, nextCode, periodFromCode, previousCode } from "./calendar";
import { downloadFinancialReport, type AppStoreCredentials } from "./client";
import { estimateCents, fetchEcbRates } from "./ecb";
import { parseFinancialReport } from "./report";

/** A period with no report this long after its end had no sales: it is not checked again. */
const NO_SALES_AFTER_DAYS = 60;
const DAY = 24 * 60 * 60 * 1000;


/**
 * Records the products of report lines: new ones are created, known ones get the report's name when
 * `rename` (a newer report) and it changed. Batched: one query to read, one transaction to write.
 */
async function recordProducts(
  accountId: string,
  lines: { appleId: string; sku: string; title: string }[],
  rename: boolean,
): Promise<void> {
  const byId = new Map(lines.filter((l) => l.appleId).map((l) => [l.appleId, l]));
  if (byId.size === 0) return;
  const known = await prisma.appleProduct.findMany({
    where: { accountId, appleId: { in: [...byId.keys()] } },
    select: { id: true, appleId: true, sku: true, title: true },
  });
  const knownIds = new Set(known.map((p) => p.appleId));
  const renames = rename
    ? known.flatMap((p) => {
        const line = byId.get(p.appleId)!;
        return line.sku !== p.sku || line.title !== p.title
          ? [prisma.appleProduct.update({ where: { id: p.id }, data: { sku: line.sku, title: line.title } })]
          : [];
      })
    : [];
  await prisma.$transaction([
    prisma.appleProduct.createMany({
      data: [...byId.values()].filter((l) => !knownIds.has(l.appleId)).map((l) => ({ accountId, appleId: l.appleId, sku: l.sku, title: l.title })),
      skipDuplicates: true,
    }),
    ...renames,
  ]);
}

/** Stores the report of a period with the ECB rates of today. Returns false when Apple has none. */
async function importPeriod(account: AppleAccount, credentials: AppStoreCredentials, code: string, today: string): Promise<boolean> {
  const tsv = await downloadFinancialReport(credentials, code);
  if (tsv === null) return false;
  const lines = parseFinancialReport(tsv);
  if (lines.length === 0) return false;

  let ecbRates: Prisma.InputJsonValue | undefined;
  let estimated: number | null = null;
  try {
    const rates = await fetchEcbRates(
      lines.map((l) => l.currency),
      today,
    );
    ecbRates = rates as unknown as Prisma.InputJsonValue;
    estimated = estimateCents(lines, rates.rates);
  } catch (error) {
    // No estimate: the admin types the amount. The report itself is what matters.
    console.warn("[fic-invoicing] ECB rates unavailable", error instanceof Error ? error.message : error);
  }

  // Products seen for the first time wait for the admin to assign them to a project.
  await recordProducts(account.id, lines, true);

  const period = periodFromCode(code);
  await prisma.appStoreReport.upsert({
    where: { accountId_period: { accountId: account.id, period: code } },
    create: {
      accountId: account.id,
      period: code,
      periodStart: period.start,
      periodEnd: period.end,
      lines: lines as unknown as Prisma.InputJsonValue,
      ecbRates,
      estimatedCents: estimated,
    },
    update: {},
  });
  return true;
}

export interface CheckResult {
  found: string[];
  nextPeriod: string;
}

/**
 * Checks every ended period from the account's `nextPeriod` on. Reports found are stored as READY;
 * `nextPeriod` moves past the periods that are settled (a report exists, or none came long after).
 */
export async function checkAccount(accountId: string, now: Date = new Date()): Promise<CheckResult> {
  const account = await prisma.appleAccount.findUniqueOrThrow({ where: { id: accountId } });
  const known = new Set(
    (await prisma.appStoreReport.findMany({ where: { accountId }, select: { period: true } })).map((r) => r.period),
  );
  const lastEnded = lastEndedPeriod(now).code;
  const today = todayInItaly(now);
  const found: string[] = [];
  let next = account.nextPeriod;
  let advancing = true;

  try {
    const credentials = credentialsOf(account);
    for (let code = account.nextPeriod; code <= lastEnded; code = nextCode(code)) {
      let settled = known.has(code);
      if (!settled) {
        settled = await importPeriod(account, credentials, code, today);
        if (settled) found.push(code);
        else settled = now.getTime() - periodFromCode(code).end.getTime() > NO_SALES_AFTER_DAYS * DAY;
      }
      if (advancing && settled) next = nextCode(code);
      else advancing = false;
    }
    await prisma.appleAccount.update({
      where: { id: accountId },
      data: { nextPeriod: next, lastCheckedAt: now, lastError: null },
    });
    // New products: find their app, so they follow its project.
    if (found.length > 0) {
      await syncApps(accountId, now).catch((error) =>
        console.warn("[fic-invoicing] could not link Apple products to apps", error instanceof Error ? error.message : error),
      );
    }
  } catch (error) {
    await prisma.appleAccount.update({
      where: { id: accountId },
      data: { nextPeriod: next, lastCheckedAt: now, lastError: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
  return { found, nextPeriod: next };
}

let running: Promise<void> | null = null;

/** Checks every account, one at a time. Concurrent calls share the run in progress. */
export function checkAllAccounts(): Promise<void> {
  running ??= (async () => {
    try {
      const accounts = await prisma.appleAccount.findMany({ select: { id: true } });
      for (const { id } of accounts) {
        await checkAccount(id).catch((error) =>
          console.error("[fic-invoicing] App Store check failed", id, error instanceof Error ? error.message : error),
        );
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

/**
 * Records the products sold in the last `lookBack` ended periods, without creating reports, so the
 * admin can assign them to projects before the next report arrives. Returns how many are new.
 */
export async function discoverProducts(accountId: string, now: Date = new Date(), lookBack = 24): Promise<number> {
  const account = await prisma.appleAccount.findUniqueOrThrow({ where: { id: accountId } });
  const credentials = credentialsOf(account);
  const before = await prisma.appleProduct.count({ where: { accountId } });
  let code = lastEndedPeriod(now).code;
  for (let i = 0; i < lookBack; i += 1, code = previousCode(code)) {
    const tsv = await downloadFinancialReport(credentials, code);
    if (tsv === null) continue;
    // Keep the newest name: periods are read from the latest backwards.
    await recordProducts(accountId, parseFinancialReport(tsv), false);
  }
  return (await prisma.appleProduct.count({ where: { accountId } })) - before;
}

/**
 * The period to start invoicing from when an account is set up: the one after the latest report
 * Apple has, among the last `lookBack` ended periods (those are taken as already invoiced by hand).
 * Also proves that the credentials work.
 */
export async function suggestStartPeriod(credentials: AppStoreCredentials, now: Date = new Date(), lookBack = 12): Promise<{
  start: string;
  latest: string | null;
}> {
  let code = lastEndedPeriod(now).code;
  for (let i = 0; i < lookBack; i += 1) {
    if ((await downloadFinancialReport(credentials, code)) !== null) return { start: nextCode(code), latest: code };
    code = previousCode(code);
  }
  return { start: nextCode(lastEndedPeriod(now).code), latest: null };
}
