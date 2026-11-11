import type { InvoiceStatus, Prisma } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { STATUS_INFO, StatusLegend } from "@/components/badges";
import { InvoiceActions, invoiceNotice } from "@/components/invoice-actions";
import { INVOICE_ROW_SELECT, InvoiceTable } from "@/components/invoice-table";
import { Notices } from "@/components/notices";
import { euros } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Invoices" };

const STATUSES: InvoiceStatus[] = ["ISSUED", "PENDING", "FAILED", "DELETED"];
const PAGE_SIZE = 50;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** UTC instant of 00:00 in Rome on the given yyyy-mm-dd day. */
function romeMidnight(day: string): Date {
  const utcGuess = new Date(`${day}T00:00:00Z`);
  const part = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Rome", timeZoneName: "shortOffset" })
    .formatToParts(utcGuess)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = part?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const offsetMinutes = match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0)) : 0;
  return new Date(utcGuess.getTime() - offsetMinutes * 60_000);
}

function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function romeToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
}

function presets(): { label: string; from: string; to: string }[] {
  const today = romeToday();
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthStart = `${y}-${pad(m)}-01`;
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const prevStart = `${prevY}-${pad(prevM)}-01`;
  const prevEnd = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  return [
    { label: "This month", from: monthStart, to: today },
    { label: "Last month", from: prevStart, to: prevEnd },
    { label: `Year ${y}`, from: `${y}-01-01`, to: today },
  ];
}

export default async function AllInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    project?: string;
    from?: string;
    to?: string;
    page?: string;
    notice?: string;
  }>;
}) {
  const query = await searchParams;
  const projects = await prisma.project.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  const status = STATUSES.find((s) => s === query.status);
  const projectId = projects.find((t) => t.id === query.project)?.id;
  const from = query.from && DAY.test(query.from) ? query.from : undefined;
  const to = query.to && DAY.test(query.to) ? query.to : undefined;
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);

  const scope: Prisma.InvoiceWhereInput = {
    ...(projectId ? { projectId } : {}),
    ...(from || to
      ? { createdAt: { ...(from ? { gte: romeMidnight(from) } : {}), ...(to ? { lt: romeMidnight(nextDay(to)) } : {}) } }
      : {}),
  };
  // "All" leaves deleted invoices out: they only show under their own tab.
  const where: Prisma.InvoiceWhereInput = { ...scope, status: status ?? { not: "DELETED" } };

  const [invoices, total, counts, issued] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      select: { ...INVOICE_ROW_SELECT, project: { select: { id: true, name: true } } },
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    prisma.invoice.aggregate({
      where: { ...scope, status: "ISSUED", dryRun: false },
      _count: { _all: true },
      _sum: { amountCents: true, stampDutyCents: true },
    }),
  ]);
  const countBy = new Map(counts.map((c) => [c.status, c._count._all]));
  const all = counts.filter((c) => c.status !== "DELETED").reduce((sum, c) => sum + c._count._all, 0);
  const { notice, error } = invoiceNotice(query.notice);

  const href = (over: Partial<Record<"status" | "project" | "from" | "to" | "page", string | undefined>>) => {
    const values = { status, project: projectId, from, to, page: undefined as string | undefined, ...over };
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(values)) if (v) qs.set(k, v);
    const str = qs.toString();
    return str ? `/admin/invoices?${str}` : "/admin/invoices";
  };
  const filtered = Boolean(projectId || from || to);

  return (
    <>
      <div className="page-head">
        <h1>Invoices</h1>
        <p className="sub">
          Every invoice of every project. Filter by project and period. Anything not sent to SDI can be deleted.
        </p>
      </div>
      <Notices notice={notice} error={error} />

      <form method="get" action="/admin/invoices" className="filters">
        {status && <input type="hidden" name="status" value={status} />}
        <div className="field">
          <label htmlFor="project">Project</label>
          <select id="project" name="project" defaultValue={projectId ?? ""}>
            <option value="">All projects</option>
            {projects.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field narrow">
          <label htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={from} />
        </div>
        <div className="field narrow">
          <label htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={to} />
        </div>
        <div className="btn-row">
          <button type="submit" className="btn">
            Apply
          </button>
          {filtered && (
            <Link href={href({ project: undefined, from: undefined, to: undefined })} className="btn secondary">
              Clear
            </Link>
          )}
        </div>
        <div className="btn-row" style={{ flexBasis: "100%", gap: 18, fontSize: 14 }}>
          <span className="hint">Quick periods:</span>
          {presets().map((p) => (
            <Link key={p.label} href={href({ from: p.from, to: p.to })}>
              {p.label}
            </Link>
          ))}
        </div>
      </form>

      <nav className="status-tabs" aria-label="Filter by status">
        <Link href={href({ status: undefined })} className="status-tab" aria-current={!status ? "true" : undefined}>
          All <span className="count">{all}</span>
        </Link>
        {STATUSES.map((s) => (
          <Link key={s} href={href({ status: s })} className="status-tab" aria-current={status === s ? "true" : undefined}>
            {STATUS_INFO[s].label} <span className="count">{countBy.get(s) ?? 0}</span>
          </Link>
        ))}
      </nav>

      <p className="totals">
        <span>
          Real invoices issued: <strong>{issued._count._all}</strong>
        </span>
        <span>
          Amount: <strong>{euros(issued._sum.amountCents ?? 0)}</strong>
        </span>
        <span>
          Stamp duty: <strong>{euros(issued._sum.stampDutyCents ?? 0)}</strong>
        </span>
        <span className="hint">Dry runs, failed and deleted invoices are not counted.</span>
      </p>

      {invoices.length === 0 ? (
        <div className="empty" style={{ borderTop: "2px solid var(--rule)" }}>
          <h2>No invoices match</h2>
          <p>
            {filtered || status
              ? "Nothing for these filters. Widen the period or pick another project or status."
              : "Invoices appear here as soon as an app sends its first request to the API."}
          </p>
          {(filtered || status) && (
            <Link href="/admin/invoices" className="btn secondary">
              Show all invoices
            </Link>
          )}
        </div>
      ) : (
        <InvoiceTable
          invoices={invoices}
          showProject
          actions={(inv) =>
            inv.project ? (
              <InvoiceActions inv={inv} projectId={inv.project.id} returnTo={href({ page: page > 1 ? String(page) : undefined })} />
            ) : null
          }
        />
      )}

      {(page > 1 || page * PAGE_SIZE < total) && (
        <div className="pager">
          {page > 1 ? <Link href={href({ page: String(page - 1) })}>Newer</Link> : <span />}
          <span className="num">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          {page * PAGE_SIZE < total ? <Link href={href({ page: String(page + 1) })}>Older</Link> : <span />}
        </div>
      )}

      <section style={{ marginTop: 48 }}>
        <h2 className="subhead">What the statuses mean</h2>
        <StatusLegend />
      </section>
    </>
  );
}
