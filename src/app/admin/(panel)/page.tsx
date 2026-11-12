import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Plus } from "@/components/icons";
import { Notice, Notices } from "@/components/notices";
import { SetupLine, setupProgress } from "@/components/setup-line";
import { labelEn, periodFromCode } from "@/lib/appstore/calendar";
import { productProject } from "@/lib/appstore/apps";
import type { ReportLine } from "@/lib/appstore/report";
import { factorState } from "@/lib/admin-security";
import { prisma } from "@/lib/prisma";
import { PROJECT_INCLUDE } from "@/lib/projects/config";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const [projects, failed, appStoreReady, appleProducts, security] = await Promise.all([
    prisma.project.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        ...PROJECT_INCLUDE,
        // Deleted invoices are not counted: they only show under the Deleted tab.
        _count: { select: { invoices: { where: { status: { not: "DELETED" } } } } },
      },
    }),
    prisma.invoice.groupBy({ by: ["projectId"], where: { status: "FAILED" }, _count: { _all: true } }),
    prisma.appStoreReport.findMany({
      where: { status: "READY", invoiceId: null },
      orderBy: { period: "asc" },
      select: {
        period: true,
        lines: true,
        account: { select: { id: true } },
      },
    }),
    prisma.appleProduct.findMany({
      include: { project: { select: { name: true } }, app: { include: { project: { select: { name: true } } } } },
    }),
    factorState(),
  ]);
  const unassignedProducts = appleProducts.filter((p) => !productProject(p));
  // A report ready on an Apple account is flagged on every project whose products it sells.
  const readyBy = new Map<string, { accountId: string; months: string[] }>();
  for (const r of appStoreReady) {
    const sold = new Set((r.lines as unknown as ReportLine[]).map((l) => l.appleId));
    for (const product of appleProducts) {
      const projectId = productProject(product)?.projectId;
      if (product.accountId !== r.account.id || !projectId || !sold.has(product.appleId)) continue;
      const entry = readyBy.get(projectId) ?? { accountId: r.account.id, months: [] };
      const month = labelEn(periodFromCode(r.period));
      if (!entry.months.includes(month)) entry.months.push(month);
      readyBy.set(projectId, entry);
    }
  }
  const failedBy = new Map(failed.map((f) => [f.projectId, f._count._all]));

  return (
    <>
      <div className="page-head">
        <h1>Projects</h1>
        <div className="actions">
          <Link className="btn" href="/admin/projects/new">
            <Plus />
            New project
          </Link>
        </div>
        <p className="sub">
          One project per app that issues invoices. Each line shows how far its setup has come, from created to live.
        </p>
      </div>
      <Notices error={error} />
      {!security.enabled && (
        <Notice tone="warn">
          Two-factor sign-in is off: the password alone opens this panel.{" "}
          <Link href="/admin/security">Add a passkey or an authenticator app</Link>.
        </Notice>
      )}
      {unassignedProducts.length > 0 && (
        <Notice tone="warn">
          Some Apple apps or products have no project yet:{" "}
          <Link href={`/admin/apple/${unassignedProducts[0].accountId}#products`}>assign them</Link> to invoice Apple.
        </Notice>
      )}

      {projects.length === 0 ? (
        <div className="empty">
          <h2>No projects yet</h2>
          <p>
            Create a project for each app that issues invoices. You get its API key, then pick the Fatture in Cloud
            company it invoices from and test it in dry run.
          </p>
          <Link className="btn" href="/admin/projects/new">
            <Plus />
            Create the first project
          </Link>
        </div>
      ) : (
        <ul className="project-rows">
          {projects.map((t) => {
            const progress = setupProgress(t);
            const failedCount = failedBy.get(t.id) ?? 0;
            return (
              <li key={t.id} className="project-row">
                <div>
                  <Link href={`/admin/projects/${t.id}`} className="project-name">
                    {t.name}
                  </Link>
                  <div className="project-meta">
                    <code>{t.slug}</code>
                    {t.company && (
                      <>
                        <span>{t.company.name}</span>
                        <span>{t.company.fiscalRegime === "FORFETTARIO" ? "Forfettario" : "Ordinario"}</span>
                      </>
                    )}
                    {!t.active && <span className="tag">Disabled</span>}
                  </div>
                  {failedCount > 0 && (
                    <Link
                      href={`/admin/projects/${t.id}/invoices?status=FAILED`}
                      className="mark failed project-failed"
                    >
                      {failedCount} failed {failedCount === 1 ? "invoice" : "invoices"}
                    </Link>
                  )}
                  {readyBy.has(t.id) && (
                    <Link href={`/admin/apple/${readyBy.get(t.id)!.accountId}#reports`} className="project-next">
                      Apple report ready: {readyBy.get(t.id)!.months.join(", ")}
                      <ArrowRight />
                    </Link>
                  )}
                  {progress.next && (
                    <Link
                      href={progress.next.href}
                      className={`project-next${progress.next.problem ? " problem" : ""}`}
                    >
                      {progress.next.label}
                      <ArrowRight />
                    </Link>
                  )}
                </div>
                <SetupLine progress={progress} />
                <Link href={`/admin/projects/${t.id}/invoices`} className="project-count">
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
