import { prisma } from "../prisma";

/** Companies an Apple account can issue from, labelled "Company · Fatture in Cloud account". */
export async function companyChoices(): Promise<{ id: string; label: string }[]> {
  const companies = await prisma.company.findMany({ orderBy: { name: "asc" }, include: { account: { select: { label: true } } } });
  return companies.map((c) => ({ id: c.id, label: `${c.name} · ${c.account.label}` }));
}
