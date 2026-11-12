/**
 * Apps of an Apple account and the link between report products and their app, so that apps (not
 * each in-app purchase) are assigned to projects.
 */
import type { AppleApp, AppleProduct, Project } from "@prisma/client";
import { prisma } from "../prisma";
import { credentialsOf } from "./credentials";
import { downloadMonthlySalesReport, listApps, parentsFromSalesReport } from "./client";

/** Months of sales reports read to find the app of an in-app purchase. */
const SALES_LOOK_BACK_MONTHS = 12;

type ProductWithApp = AppleProduct & {
  project: Pick<Project, "name"> | null;
  app: (AppleApp & { project: Pick<Project, "name"> | null }) | null;
};

/** The project a product belongs to: its app's, or its own when its app has none or is unknown. */
export function productProject(product: ProductWithApp): { projectId: string; name: string } | null {
  if (product.app?.projectId && product.app.project) return { projectId: product.app.projectId, name: product.app.project.name };
  if (product.projectId && product.project) return { projectId: product.projectId, name: product.project.name };
  return null;
}

/** Products of an account with what `groupReport` needs: the project each belongs to. */
export async function productsWithProjects(accountId: string) {
  const products = await prisma.appleProduct.findMany({
    where: { accountId },
    include: { project: { select: { name: true } }, app: { include: { project: { select: { name: true } } } } },
  });
  return products.map((p) => {
    const project = productProject(p);
    return { ...p, projectId: project?.projectId ?? null, project: project ? { name: project.name } : null };
  });
}

/** "2026-10" for the month before `now`, then backwards. */
function monthsBack(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/**
 * Refreshes the account's apps and links every product to its app: a paid app is its own product;
 * an in-app purchase gets its parent app from the monthly sales reports. A project assigned by hand
 * to a product moves to its app when the app has none. Returns how many products got linked.
 */
export async function syncApps(accountId: string, now: Date = new Date()): Promise<number> {
  const account = await prisma.appleAccount.findUniqueOrThrow({ where: { id: accountId } });
  const credentials = credentialsOf(account);

  // New apps in one insert; known ones only when their name or SKU changed.
  const listed = await listApps(credentials);
  const existing = new Map((await prisma.appleApp.findMany({ where: { accountId } })).map((a) => [a.appleId, a]));
  await prisma.$transaction([
    prisma.appleApp.createMany({
      data: listed.filter((a) => !existing.has(a.appleId)).map((a) => ({ accountId, ...a })),
      skipDuplicates: true,
    }),
    ...listed.flatMap((a) => {
      const known = existing.get(a.appleId);
      return known && (known.sku !== a.sku || known.name !== a.name)
        ? [prisma.appleApp.update({ where: { id: known.id }, data: { sku: a.sku, name: a.name } })]
        : [];
    }),
  ]);
  const apps = await prisma.appleApp.findMany({ where: { accountId } });
  const byAppleId = new Map(apps.map((a) => [a.appleId, a]));
  const bySku = new Map(apps.map((a) => [a.sku, a]));

  let unlinked = await prisma.appleProduct.findMany({ where: { accountId, appId: null } });
  const found = new Map<string, AppleApp>();
  for (const product of unlinked) {
    const own = byAppleId.get(product.appleId);
    if (own) found.set(product.id, own);
  }
  unlinked = unlinked.filter((p) => !found.has(p.id));
  for (const month of monthsBack(now, SALES_LOOK_BACK_MONTHS)) {
    if (unlinked.length === 0) break;
    const tsv = await downloadMonthlySalesReport(credentials, month);
    if (!tsv) continue;
    const parents = parentsFromSalesReport(tsv);
    for (const product of unlinked) {
      const app = bySku.get(parents.get(product.appleId) ?? "");
      if (app) found.set(product.id, app);
    }
    unlinked = unlinked.filter((p) => !found.has(p.id));
  }

  const products = await prisma.appleProduct.findMany({ where: { id: { in: [...found.keys()] } } });
  await prisma.$transaction(
    products.flatMap((product) => {
      const app = found.get(product.id)!;
      return [
        prisma.appleProduct.update({ where: { id: product.id }, data: { appId: app.id } }),
        ...(product.projectId
          ? [prisma.appleApp.updateMany({ where: { id: app.id, projectId: null }, data: { projectId: product.projectId } })]
          : []),
      ];
    }),
  );
  return found.size;
}
