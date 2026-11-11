import type { InvoiceStatus } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/badges";
import { Notices } from "@/components/notices";
import { isDeletable } from "@/lib/invoices/service";
import { prisma } from "@/lib/prisma";
import { deleteInvoiceAction, retryInvoiceAction } from "../../../../actions";

const STATUSES: InvoiceStatus[] = ["PENDING", "ISSUED", "FAILED", "DELETED"];
const PAGE_SIZE = 50;

function euros(cents: number): string {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(cents / 100);
}

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
  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      select: {
        id: true,
        createdAt: true,
        status: true,
        externalRef: true,
        customerCategory: true,
        amountCents: true,
        stampDutyCents: true,
        ficNumber: true,
        ficDocumentId: true,
        dryRun: true,
        attempts: true,
        errorMessage: true,
        sdiSentAt: true,
        sdiError: true,
        deletedAt: true,
      },
    }),
    prisma.invoice.count({ where }),
  ]);

  const isError = query.notice?.startsWith("retry_error") || query.notice?.startsWith("delete_error");
  const notice = isError ? undefined : query.notice;
  const error = !isError
    ? undefined
    : query.notice!.startsWith("retry_error")
      ? `Retry refused (${query.notice})`
      : `Delete refused: ${query.notice!.split(":").slice(1).join(":") || "unexpected error, check the server logs"}`;
  const filterHref = (s?: InvoiceStatus) => `/admin/tenants/${tenant.id}/invoices${s ? `?status=${s}` : ""}`;

  return (
    <>
      <div className="row spread">
        <h1>Invoices · {tenant.name}</h1>
        <Link className="button secondary" href={`/admin/tenants/${tenant.id}`}>
          Tenant settings
        </Link>
      </div>
      <Notices notice={notice} error={error} />
      <p className="row small">
        <span className="muted">Filter:</span>
        <Link href={filterHref()}>{status ? "all" : <strong>all</strong>}</Link>
        {STATUSES.map((s) => (
          <Link key={s} href={filterHref(s)}>
            {status === s ? <strong>{s}</strong> : s}
          </Link>
        ))}
        <span className="muted">· {total} total</span>
      </p>
      <div className="card table-wrap">
        {invoices.length === 0 ? (
          <p className="muted">No invoices.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Status</th>
                <th>Number</th>
                <th>Ref</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Details</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const sdiRetry = inv.status === "ISSUED" && inv.sdiError && !inv.sdiSentAt;
                return (
                  <tr key={inv.id}>
                    <td className="small">{inv.createdAt.toISOString().replace("T", " ").slice(0, 16)}</td>
                    <td>
                      <StatusBadge status={inv.status} />
                      {inv.dryRun && <span className="badge muted"> dry run</span>}
                    </td>
                    <td>{inv.ficNumber ?? "—"}</td>
                    <td className="small">
                      <code>{inv.externalRef ?? inv.id}</code>
                    </td>
                    <td className="small">{inv.customerCategory}</td>
                    <td>
                      {euros(inv.amountCents)}
                      {inv.stampDutyCents > 0 && <span className="muted small"> · bollo {euros(inv.stampDutyCents)}</span>}
                    </td>
                    <td className="small">
                      {inv.errorMessage && <span style={{ color: "var(--danger)" }}>{inv.errorMessage}</span>}
                      {inv.sdiSentAt && <span className="muted">Sent to SDI</span>}
                      {inv.sdiError && <span style={{ color: "var(--danger)" }}>SDI: {inv.sdiError}</span>}
                      {inv.deletedAt && (
                        <span className="muted">
                          Deleted from FIC {inv.deletedAt.toISOString().replace("T", " ").slice(0, 16)}
                        </span>
                      )}
                      <span className="muted"> · {inv.attempts} attempt(s)</span>
                    </td>
                    <td>
                      {(inv.status === "FAILED" || sdiRetry) && (
                        <form action={retryInvoiceAction.bind(null, tenant.id, inv.id)}>
                          <button type="submit" className="secondary">
                            {sdiRetry ? "Resend to SDI" : "Retry"}
                          </button>
                        </form>
                      )}
                      {isDeletable(inv) && (
                        <details className="confirm">
                          <summary className="button secondary">Delete</summary>
                          <p className="small">
                            Deletes document {inv.ficNumber ?? `#${inv.ficDocumentId}`} from Fatture in Cloud. Deleting
                            an invoice that is not the latest of its numeration leaves a gap in the numbering.
                          </p>
                          <form action={deleteInvoiceAction.bind(null, tenant.id, inv.id)}>
                            <button type="submit" className="danger">
                              Confirm delete
                            </button>
                          </form>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="row small">
        {page > 1 && (
          <Link href={`${filterHref(status)}${status ? "&" : "?"}page=${page - 1}`}>← Newer</Link>
        )}
        {page * PAGE_SIZE < total && (
          <Link href={`${filterHref(status)}${status ? "&" : "?"}page=${page + 1}`}>Older →</Link>
        )}
      </p>
    </>
  );
}
