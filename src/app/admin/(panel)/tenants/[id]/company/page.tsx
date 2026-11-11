import Link from "next/link";
import { notFound } from "next/navigation";
import { Notices } from "@/components/notices";
import { listUserCompanies, type FicCompany } from "@/lib/fic/client";
import { getFicAccess } from "@/lib/fic/tokens";
import { prisma } from "@/lib/prisma";
import { selectCompanyAction } from "../../../../actions";

export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) notFound();

  let companies: FicCompany[] = [];
  let loadError: string | null = null;
  try {
    const access = await getFicAccess(tenant.id);
    companies = await listUserCompanies(access.accessToken);
  } catch (e) {
    loadError = e instanceof Error ? e.message : "Could not list companies";
  }

  return (
    <div className="narrow">
      <h1>Choose the Fatture in Cloud company</h1>
      <p className="muted">Tenant: {tenant.name}</p>
      <Notices error={error} />
      {loadError && <p className="notice error">{loadError}</p>}
      <div className="card">
        {companies.length === 0 && !loadError ? (
          <p>This Fatture in Cloud user has no companies.</p>
        ) : (
          <form action={selectCompanyAction.bind(null, tenant.id)}>
            {companies.map((c) => (
              <label key={c.id} className="inline">
                <input type="radio" name="companyId" value={c.id} required defaultChecked={c.id === tenant.ficCompanyId} />
                {c.name} <span className="muted small">#{c.id}</span>
              </label>
            ))}
            <p>
              <button type="submit">Use this company</button>
            </p>
          </form>
        )}
      </div>
      <Link href={`/admin/tenants/${tenant.id}`}>Back to tenant</Link>
    </div>
  );
}
