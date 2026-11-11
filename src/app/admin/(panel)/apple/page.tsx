import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Plus } from "@/components/icons";
import { Notices } from "@/components/notices";
import { labelEn, periodFromCode } from "@/lib/appstore/calendar";
import { dateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Apple" };

export default async function AppleAccountsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { notice, error } = await searchParams;
  const accounts = await prisma.appleAccount.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      company: { select: { name: true } },
      reports: { where: { status: "READY" }, select: { period: true } },
      products: { select: { projectId: true, project: { select: { id: true, name: true } } } },
    },
  });

  return (
    <>
      <div className="page-head">
        <h1>Apple</h1>
        <div className="actions">
          <Link className="btn" href="/admin/apple/new">
            <Plus />
            Connect an account
          </Link>
        </div>
        <p className="sub">
          App Store Connect accounts Apple pays. Each monthly financial report becomes one invoice to Apple, with a line
          for each project whose apps sold that month.
        </p>
      </div>
      <Notices notice={notice} error={error} />

      {accounts.length === 0 ? (
        <div className="empty">
          <h2>No Apple account</h2>
          <p>Connect the App Store Connect account of your apps to have the monthly invoice to Apple prepared for you.</p>
          <Link className="btn" href="/admin/apple/new">
            <Plus />
            Connect an Apple account
          </Link>
        </div>
      ) : (
        <ul className="accounts">
          {accounts.map((a) => {
            const projects = [...new Map(a.products.filter((p) => p.project).map((p) => [p.project!.id, p.project!.name])).values()];
            const unassigned = a.products.filter((p) => !p.projectId).length;
            return (
              <li key={a.id} className="account">
                <div className="account-head">
                  <div>
                    <Link href={`/admin/apple/${a.id}`} className="company-name account-name">
                      {a.label}
                    </Link>
                    <div className="project-meta">
                      <span>Vendor {a.vendorNumber}</span>
                      <span>{a.company ? `Issued by ${a.company.name}` : "No company"}</span>
                      {a.dryRun && <span className="mark dry">Dry run</span>}
                      <span>{a.lastCheckedAt ? `Checked ${dateTime(a.lastCheckedAt)}` : "Not checked yet"}</span>
                      {a.lastError && <span className="mark failed">Last check failed</span>}
                    </div>
                  </div>
                  <Link href={`/admin/apple/${a.id}`} className="project-next">
                    Open
                    <ArrowRight />
                  </Link>
                </div>
                <p>
                  {projects.length > 0 ? `Projects: ${projects.join(", ")}.` : "No product assigned to a project yet."}
                  {unassigned > 0 && ` ${unassigned} ${unassigned === 1 ? "product" : "products"} to assign.`}
                </p>
                {a.reports.length > 0 ? (
                  <Link href={`/admin/apple/${a.id}#reports`} className="project-next">
                    Report ready: {a.reports.map((r) => labelEn(periodFromCode(r.period))).join(", ")}
                    <ArrowRight />
                  </Link>
                ) : (
                  <p className="hint">Next report expected: {labelEn(periodFromCode(a.nextPeriod))}.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
