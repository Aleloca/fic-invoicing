/** A report's lines grouped into invoice lines: one per app, or per project for products without an app. */
import type { ReportLine } from "./report";

export interface InvoiceGroup {
  /** "app:<id>" or "project:<id>": the form field of its amount is `amount_<key>`. */
  key: string;
  projectId: string;
  projectName: string;
  /** The app's name on App Store Connect, when the group is an app. */
  appName: string | null;
  itemName: string | null;
  description: string | null;
  lines: ReportLine[];
  /** Euro cents at the ECB rates; null when a currency has no rate. */
  estimatedCents: number | null;
}

export interface ReportGroups {
  groups: InvoiceGroup[];
  /** Lines whose product has no project yet (or older reports without products). */
  unassigned: ReportLine[];
}

export interface GroupableProduct {
  appleId: string;
  /** The effective project (its app's, or its own when the app is unknown). */
  projectId: string | null;
  project: { name: string } | null;
  app: { id: string; name: string; projectId: string | null; invoiceItemName: string | null; invoiceDescription: string | null } | null;
}

export function lineEuroCents(line: Pick<ReportLine, "currency" | "amount">, rates: Record<string, number> | undefined): number | null {
  const amount = Number(line.amount);
  if (line.currency === "EUR") return Math.round(amount * 100);
  const rate = rates?.[line.currency];
  return rate ? Math.round((amount / rate) * 100) : null;
}

export function groupReport(lines: ReportLine[], products: GroupableProduct[], rates: Record<string, number> | undefined): ReportGroups {
  const byApple = new Map(products.map((p) => [p.appleId, p]));
  const groups = new Map<string, InvoiceGroup>();
  const unassigned: ReportLine[] = [];
  for (const line of lines) {
    const product = line.appleId ? byApple.get(line.appleId) : undefined;
    if (!product?.projectId || !product.project) {
      unassigned.push(line);
      continue;
    }
    const app = product.app?.projectId === product.projectId ? product.app : null;
    const key = app ? `app:${app.id}` : `project:${product.projectId}`;
    const group = groups.get(key) ?? {
      key,
      projectId: product.projectId,
      projectName: product.project.name,
      appName: app?.name ?? null,
      itemName: app?.invoiceItemName ?? null,
      description: app?.invoiceDescription ?? null,
      lines: [],
      estimatedCents: 0,
    };
    group.lines.push(line);
    const euro = lineEuroCents(line, rates);
    group.estimatedCents = group.estimatedCents === null || euro === null ? null : group.estimatedCents + euro;
    groups.set(key, group);
  }
  const order = (g: InvoiceGroup) => `${g.projectName} ${g.appName ?? ""}`;
  return { groups: [...groups.values()].sort((a, b) => order(a).localeCompare(order(b))), unassigned };
}

/**
 * A project proposed for a product or app: the one whose slug or name appears in its SKU or title
 * ("zentap_pro_unlock" → ZenTap). The longest match wins, so "ZenTap" beats a project called "App";
 * null when nothing matches or two projects match equally well.
 */
export function suggestProject<T extends { id: string; name: string; slug: string }>(
  product: { sku: string; title: string },
  projects: T[],
): T | null {
  const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const haystack = `${norm(product.sku)} ${norm(product.title)}`;
  let best: T | null = null;
  let bestLength = 0;
  let tie = false;
  for (const project of projects) {
    const length = Math.max(0, ...[norm(project.slug), norm(project.name)].filter((k) => k.length >= 3 && haystack.includes(k)).map((k) => k.length));
    if (length === 0) continue;
    if (length > bestLength) {
      best = project;
      bestLength = length;
      tie = false;
    } else if (length === bestLength && project.id !== best?.id) {
      tie = true;
    }
  }
  return tie ? null : best;
}
