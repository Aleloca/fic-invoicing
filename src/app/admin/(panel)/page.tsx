import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Plus } from "@/components/icons";
import { Notices } from "@/components/notices";
import { SetupLine, setupProgress } from "@/components/setup-line";
import { prisma } from "@/lib/prisma";
import { PROJECT_INCLUDE } from "@/lib/projects/config";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const [projects, failed] = await Promise.all([
    prisma.project.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        ...PROJECT_INCLUDE,
        // Deleted invoices are not counted: they only show under the Deleted tab.
        _count: { select: { invoices: { where: { status: { not: "DELETED" } } } } },
      },
    }),
    prisma.invoice.groupBy({ by: ["projectId"], where: { status: "FAILED" }, _count: { _all: true } }),
  ]);
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
