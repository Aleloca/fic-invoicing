/** A report's lines grouped by the project their product belongs to. */
import type { AppleProduct } from "@prisma/client";
import type { ReportLine } from "./report";

export interface ProjectGroup {
  projectId: string;
  projectName: string;
  lines: ReportLine[];
  /** Euro cents at the ECB rates; null when a currency has no rate. */
  estimatedCents: number | null;
}

export interface ReportGroups {
  projects: ProjectGroup[];
  /** Lines whose product is not assigned to a project yet (or older reports without products). */
  unassigned: ReportLine[];
}

export function lineEuroCents(line: Pick<ReportLine, "currency" | "amount">, rates: Record<string, number> | undefined): number | null {
  const amount = Number(line.amount);
  if (line.currency === "EUR") return Math.round(amount * 100);
  const rate = rates?.[line.currency];
  return rate ? Math.round((amount / rate) * 100) : null;
}

export function groupReport(
  lines: ReportLine[],
  products: (Pick<AppleProduct, "appleId" | "projectId"> & { project: { name: string } | null })[],
  rates: Record<string, number> | undefined,
): ReportGroups {
  const byApple = new Map(products.map((p) => [p.appleId, p]));
  const groups = new Map<string, ProjectGroup>();
  const unassigned: ReportLine[] = [];
  for (const line of lines) {
    const product = line.appleId ? byApple.get(line.appleId) : undefined;
    if (!product?.projectId || !product.project) {
      unassigned.push(line);
      continue;
    }
    const group = groups.get(product.projectId) ?? {
      projectId: product.projectId,
      projectName: product.project.name,
      lines: [],
      estimatedCents: 0,
    };
    group.lines.push(line);
    const euro = lineEuroCents(line, rates);
    group.estimatedCents = group.estimatedCents === null || euro === null ? null : group.estimatedCents + euro;
    groups.set(product.projectId, group);
  }
  return { projects: [...groups.values()].sort((a, b) => a.projectName.localeCompare(b.projectName)), unassigned };
}

/**
 * A project proposed for a product: the one whose slug or name appears in the product's SKU or
 * title ("zentap_pro_unlock" → ZenTap). The longest match wins, so "ZenTap" beats a project called
 * "App"; null when nothing matches or two projects match equally well.
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
