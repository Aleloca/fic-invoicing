import type { InvoiceStatus } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { STATUS_INFO, StatusLegend } from "@/components/badges";
import { ArrowLeft } from "@/components/icons";
import { INVOICE_ROW_SELECT, InvoiceTable } from "@/components/invoice-table";
import { Notices } from "@/components/notices";
import { isDeletable } from "@/lib/invoices/service";
import { prisma } from "@/lib/prisma";
import { deleteInvoiceAction, retryInvoiceAction } from "../../../../actions";

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
  const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!tenant) notFound();

  const status = STATUSES.find((s) => s === query.status);
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const where = { tenantId: tenant.id, ...(status ? { status } : {}) };
  const [invoices, total, counts] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      select: INVOICE_ROW_SELECT,
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.groupBy({ by: ["status"], where: { tenantId: tenant.id }, _count: { _all: true } }),
  ]);
  const countBy = new Map(counts.map((c) => [c.status, c._count._all]));
  const all = counts.reduce((sum, c) => sum + c._count._all, 0);

  const isError = query.notice?.startsWith("retry_error") || query.notice?.startsWith("delete_error");
  const notice = isError ? undefined : query.notice;
  const error = !isError
    ? undefined
    : query.notice!.startsWith("retry_error")
      ? `Retry refused (${query.notice})`
      : `Delete refused: ${query.notice!.split(":").slice(1).join(":") || "unexpected error, check the server logs"}`;
  const base = `/admin/tenants/${tenant.id}/invoices`;
  const href = (s?: InvoiceStatus, p?: number) => {
    const qs = new URLSearchParams();
    if (s) qs.set("status", s);
    if (p && p > 1) qs.set("page", String(p));
    const str = qs.toString();
    return str ? `${base}?${str}` : base;
  };

  return (
    <>
      <Link href={`/admin/tenants/${tenant.id}`} className="crumb">
        <ArrowLeft />
        {tenant.name}
      </Link>
      <div className="page-head">
        <h1>Invoices</h1>
        <div className="actions">
          <Link className="btn secondary" href={`/admin/invoices?tenant=${tenant.id}`}>
            Filter by period
          </Link>
        </div>
        <p className="sub">Every request {tenant.name} sent, newest first. Failed invoices can be retried here.</p>
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
          actions={(inv) => {
            const sdiRetry = inv.status === "ISSUED" && inv.sdiError && !inv.sdiSentAt;
            const canRetry = inv.status === "FAILED" || sdiRetry;
            const canDelete = isDeletable(inv);
            if (!canRetry && !canDelete) return null;
            return (
              <div className="row-actions">
                {canRetry && (
                  <form action={retryInvoiceAction.bind(null, tenant.id, inv.id)}>
                    <button type="submit" className="btn small">
                      {sdiRetry ? "Resend to SDI" : "Retry"}
                    </button>
                  </form>
                )}
                {canDelete && (
                  <details className="confirm">
                    <summary className="btn small danger">Delete</summary>
                    <div className="confirm-box">
                      <p>
                        Deletes document {inv.ficNumber ?? `#${inv.ficDocumentId}`} from Fatture in Cloud. Deleting an
                        invoice that is not the latest of its numeration leaves a gap in the numbering.
                      </p>
                      <form action={deleteInvoiceAction.bind(null, tenant.id, inv.id)}>
                        <button type="submit" className="btn small danger solid">
                          Confirm delete
                        </button>
                      </form>
                    </div>
                  </details>
                )}
              </div>
            );
          }}
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
