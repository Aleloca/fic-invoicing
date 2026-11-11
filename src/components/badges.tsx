import type { InvoiceStatus, Tenant } from "@prisma/client";

export function ConnectionBadge({ tenant }: { tenant: Pick<Tenant, "accessTokenEnc" | "ficCompanyId" | "ficCompanyName" | "ficNeedsReconnect"> }) {
  if (tenant.ficNeedsReconnect) return <span className="badge danger">reconnect required</span>;
  if (!tenant.accessTokenEnc) return <span className="badge muted">not connected</span>;
  if (!tenant.ficCompanyId) return <span className="badge warn">pick a company</span>;
  return <span className="badge ok">{tenant.ficCompanyName ?? `company ${tenant.ficCompanyId}`}</span>;
}

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const tone = status === "ISSUED" ? "ok" : status === "FAILED" ? "danger" : "warn";
  return <span className={`badge ${tone}`}>{status}</span>;
}
