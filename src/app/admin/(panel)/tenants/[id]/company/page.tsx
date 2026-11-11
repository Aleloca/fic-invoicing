import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "@/components/icons";
import { Notice, Notices } from "@/components/notices";
import { listUserCompanies, type FicCompany } from "@/lib/fic/client";
import { getFicAccess } from "@/lib/fic/tokens";
import { prisma } from "@/lib/prisma";
import { selectCompanyAction } from "../../../../actions";

export const metadata: Metadata = { title: "Choose the company" };

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
    <div style={{ maxWidth: 720 }}>
      <Link href={`/admin/tenants/${tenant.id}`} className="crumb">
        <ArrowLeft />
        {tenant.name}
      </Link>
      <div className="page-head">
        <h1>Choose the company</h1>
        <p className="sub">
          Invoices for {tenant.name} are issued by this Fatture in Cloud company. The list shows every company the
          authorized user can access.
        </p>
      </div>
      <Notices error={error} />
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {companies.length === 0 && !loadError ? (
        <div className="empty">
          <h2>No companies</h2>
          <p>This Fatture in Cloud user has no companies. Reconnect with the user that owns the company.</p>
          <Link className="btn secondary" href={`/admin/tenants/${tenant.id}#connection`}>
            Back to the connection
          </Link>
        </div>
      ) : (
        companies.length > 0 && (
          <form action={selectCompanyAction.bind(null, tenant.id)}>
            <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="visually-hidden">Fatture in Cloud companies</legend>
              <div className="choices">
                {companies.map((c) => (
                  <label key={c.id} className="choice">
                    <input
                      type="radio"
                      name="companyId"
                      value={c.id}
                      required
                      defaultChecked={c.id === tenant.ficCompanyId}
                    />
                    <span>
                      <strong>{c.name}</strong> <span className="hint">#{c.id}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="form-foot" style={{ paddingTop: 24 }}>
              <button type="submit" className="btn">
                Use this company
              </button>
            </div>
          </form>
        )
      )}
    </div>
  );
}
