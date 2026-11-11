import type { InvoiceStatus } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STATUS_INFO, StatusLegend } from "@/components/badges";
import { ArrowLeft } from "@/components/icons";
import { InvoiceActions, invoiceNotice } from "@/components/invoice-actions";
import { INVOICE_ROW_SELECT, InvoiceTable } from "@/components/invoice-table";
import { Notices } from "@/components/notices";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Invoices" };

const STATUSES: InvoiceStatus[] = ["ISSUED", "PENDING", "FAILED", "DELETED"];
const PAGE_SIZE = 50;

export default async function InvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; notice?: string; page?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!project) notFound();

  const status = STATUSES.find((s) => s === query.status);
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  // "All" leaves deleted invoices out: they only show under their own tab.
  const where = { projectId: project.id, status: status ?? { not: "DELETED" as const } };
  const [invoices, total, counts] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      select: INVOICE_ROW_SELECT,
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.groupBy({ by: ["status"], where: { projectId: project.id }, _count: { _all: true } }),
  ]);
  const countBy = new Map(counts.map((c) => [c.status, c._count._all]));
  const all = counts.filter((c) => c.status !== "DELETED").reduce((sum, c) => sum + c._count._all, 0);
  const { notice, error } = invoiceNotice(query.notice);
  const base = `/admin/projects/${project.id}/invoices`;
  const href = (s?: InvoiceStatus, p?: number) => {
    const qs = new URLSearchParams();
    if (s) qs.set("status", s);
    if (p && p > 1) qs.set("page", String(p));
    const str = qs.toString();
    return str ? `${base}?${str}` : base;
  };

  return (
    <>
      <Link href={`/admin/projects/${project.id}`} className="crumb">
        <ArrowLeft />
        {project.name}
      </Link>
      <div className="page-head">
        <h1>Invoices</h1>
        <div className="actions">
          <Link className="btn secondary" href={`/admin/invoices?project=${project.id}`}>
            Filter by period
          </Link>
        </div>
        <p className="sub">Every request {project.name} sent, newest first. Failed invoices can be retried, and anything not sent to SDI can be deleted.</p>
      </div>
      <Notices notice={notice} error={error} />

      <nav className="status-tabs" aria-label="Filter by status">
        <Link href={href()} className="status-tab" aria-current={!status ? "true" : undefined}>
          All <span className="count">{all}</span>
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={href(s)} className="status-tab" aria-current={status === s ? "true" : undefined}>
            {STATUS_INFO[s].label} <span className="count">{countBy.get(s) ?? 0}</span>
          </Link>
        ))}
      </nav>

      {invoices.length === 0 ? (
        <div className="empty">
          <h2>{status ? `No ${STATUS_INFO[status].label.toLowerCase()} invoices` : "No invoices yet"}</h2>
          <p>
            {status
              ? "Nothing with this status. Pick another filter above."
              : "Invoices appear here as soon as the app sends its first request to the API."}
          </p>
        </div>
      ) : (
        <InvoiceTable
          invoices={invoices}
          actions={(inv) => (
            <InvoiceActions inv={inv} projectId={project.id} returnTo={href(status, page)} />
          )}
        />
      )}

      {(page > 1 || page * PAGE_SIZE < total) && (
        <div className="pager">
          {page > 1 ? <Link href={href(status, page - 1)}>Newer</Link> : <span />}
          <span className="num">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          {page * PAGE_SIZE < total ? <Link href={href(status, page + 1)}>Older</Link> : <span />}
        </div>
      )}

      <details style={{ marginTop: 40 }}>
        <summary className="subhead" style={{ cursor: "pointer", borderBottom: 0 }}>
          What the statuses mean
        </summary>
        <StatusLegend />
      </details>
    </>
  );
}
