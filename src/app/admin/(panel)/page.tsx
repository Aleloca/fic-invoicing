import Link from "next/link";
import { Notices } from "@/components/notices";
import { prisma } from "@/lib/prisma";
import { ConnectionBadge } from "@/components/badges";

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { invoices: true } } },
  });

  return (
    <>
      <div className="row spread">
        <h1>Tenants</h1>
        <Link className="button" href="/admin/tenants/new">
          New tenant
        </Link>
      </div>
      <Notices error={error} />
      <div className="card table-wrap">
        {tenants.length === 0 ? (
          <p className="muted">No tenants yet. Create one to get an API key.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Fatture in Cloud</th>
                <th>Mode</th>
                <th>Invoices</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/admin/tenants/${t.id}`}>{t.name}</Link>
                    {!t.active && <span className="badge muted"> disabled</span>}
                  </td>
                  <td>
                    <code>{t.slug}</code>
                  </td>
                  <td>
                    <ConnectionBadge tenant={t} />
                  </td>
                  <td>{t.dryRun ? <span className="badge warn">dry run</span> : <span className="badge ok">live</span>}</td>
                  <td>
                    <Link href={`/admin/tenants/${t.id}/invoices`}>{t._count.invoices}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
