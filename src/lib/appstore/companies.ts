import { prisma } from "../prisma";

/** Companies an Apple account can issue from, labelled "Company · Fatture in Cloud account". */
export async function companyChoices(): Promise<{ id: string; label: string }[]> {
  const companies = await prisma.company.findMany({ orderBy: { name: "asc" }, include: { account: { select: { label: true } } } });
  const repeated = (name: string) => companies.filter((c) => c.name === name).length > 1;
  // The Fatture in Cloud account only tells apart companies with the same name.
  return companies.map((c) => ({ id: c.id, label: repeated(c.name) ? `${c.name} · ${c.account.label}` : c.name }));
}
