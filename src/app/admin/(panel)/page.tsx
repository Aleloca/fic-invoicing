import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Plus } from "@/components/icons";
import { Notices } from "@/components/notices";
import { SetupLine, setupProgress } from "@/components/setup-line";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Tenants" };

export default async function TenantsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const [tenants, failed] = await Promise.all([
    prisma.tenant.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { invoices: true } } },
    }),
    prisma.invoice.groupBy({ by: ["tenantId"], where: { status: "FAILED" }, _count: { _all: true } }),
  ]);
  const failedBy = new Map(failed.map((f) => [f.tenantId, f._count._all]));

  return (
    <>
      <div className="page-head">
        <h1>Tenants</h1>
        <div className="actions">
          <Link className="btn" href="/admin/tenants/new">
            <Plus />
            New tenant
          </Link>
        </div>
        <p className="sub">One tenant per app. Each line shows how far its setup has come, from created to live.</p>
      </div>
      <Notices error={error} />

      {tenants.length === 0 ? (
        <div className="empty">
          <h2>No tenants yet</h2>
          <p>
            Create a tenant for each app that issues invoices. You get its API key, then connect it to a Fatture in
            Cloud company and test it in dry run.
          </p>
          <Link className="btn" href="/admin/tenants/new">
            <Plus />
            Create the first tenant
          </Link>
        </div>
      ) : (
        <ul className="tenant-rows">
          {tenants.map((t) => {
            const progress = setupProgress(t);
            const failedCount = failedBy.get(t.id) ?? 0;
            return (
              <li key={t.id} className="tenant-row">
                <div>
                  <Link href={`/admin/tenants/${t.id}`} className="tenant-name">
                    {t.name}
                  </Link>
                  <div className="tenant-meta">
                    <code>{t.slug}</code>
                    <span>{t.fiscalRegime === "FORFETTARIO" ? "Forfettario" : "Ordinario"}</span>
                    {t.ficCompanyName && <span>{t.ficCompanyName}</span>}
                    {!t.active && <span className="tag">Disabled</span>}
                  </div>
                  {failedCount > 0 && (
                    <Link
                      href={`/admin/tenants/${t.id}/invoices?status=FAILED`}
                      className="mark failed tenant-failed"
                    >
                      {failedCount} failed {failedCount === 1 ? "invoice" : "invoices"}
                    </Link>
                  )}
                  {progress.next && (
                    <Link
                      href={progress.next.href}
                      className={`tenant-next${progress.next.problem ? " problem" : ""}`}
                    >
                      {progress.next.label}
                      <ArrowRight />
                    </Link>
                  )}
                </div>
                <SetupLine progress={progress} />
                <Link href={`/admin/tenants/${t.id}/invoices`} className="tenant-count">
                  <strong>{t._count.invoices}</strong>
                  <span>{t._count.invoices === 1 ? "invoice" : "invoices"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
