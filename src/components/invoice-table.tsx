import type { CustomerCategory, InvoiceStatus } from "@prisma/client";
import Link from "next/link";
import { StatusMark } from "./badges";
import { CATEGORY_LABELS, dateTime, euros } from "@/lib/format";

export interface InvoiceRow {
  id: string;
  createdAt: Date;
  status: InvoiceStatus;
  externalRef: string | null;
  customerCategory: CustomerCategory;
  amountCents: number;
  stampDutyCents: number;
  ficNumber: string | null;
  ficDocumentId: number | null;
  dryRun: boolean;
  attempts: number;
  errorMessage: string | null;
  sdiSentAt: Date | null;
  sdiError: string | null;
  deletedAt: Date | null;
  project?: { id: string; name: string } | null;
  appleAccount?: { id: string; label: string } | null;
}

export const INVOICE_ROW_SELECT = {
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
} as const;

function Details({ inv }: { inv: InvoiceRow }) {
  return (
    <>
      {inv.errorMessage && <span className="cell-error">{inv.errorMessage}</span>}
      {inv.sdiError && <span className="cell-error">SDI: {inv.sdiError}</span>}
      {inv.sdiSentAt && <span className="cell-sub">Sent to SDI {dateTime(inv.sdiSentAt)}</span>}
      {inv.deletedAt && <span className="cell-sub">Deleted {dateTime(inv.deletedAt)}</span>}
      <span className="cell-sub">
        {inv.attempts} {inv.attempts === 1 ? "attempt" : "attempts"}
      </span>
    </>
  );
}

export function InvoiceTable({
  invoices,
  showProject = false,
  actions,
}: {
  invoices: InvoiceRow[];
  showProject?: boolean;
  actions?: (inv: InvoiceRow) => React.ReactNode;
}) {
  return (
    <div className="table-wrap stack">
      <table>
        <thead>
          <tr>
            <th scope="col">Number</th>
            {showProject && <th scope="col">Project</th>}
            <th scope="col">Status</th>
            <th scope="col">Customer</th>
            <th scope="col" className="amount">
              Amount
            </th>
            <th scope="col">Created</th>
            <th scope="col">Details</th>
            {actions && (
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id}>
              <td data-col="number">
                <span className="cell-main num">{inv.ficNumber ?? (inv.dryRun ? "Test" : "No number")}</span>
                <code className="cell-sub" title="Your app's reference">
                  {inv.externalRef ?? inv.id}
                </code>
              </td>
              {showProject && (
                <td data-col="project">
                  {inv.project ? (
                    <Link href={`/admin/projects/${inv.project.id}/invoices`}>{inv.project.name}</Link>
                  ) : inv.appleAccount ? (
                    <Link href={`/admin/apple/${inv.appleAccount.id}`}>Apple · {inv.appleAccount.label}</Link>
                  ) : null}
                </td>
              )}
              <td data-col="status">
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
                  <StatusMark status={inv.status} />
                  {inv.dryRun && <span className="tag dry">Dry run</span>}
                </span>
              </td>
              <td data-col="customer">
                <span title={inv.customerCategory}>{CATEGORY_LABELS[inv.customerCategory]}</span>
              </td>
              <td className="amount" data-col="amount">
                <span className="cell-main">{euros(inv.amountCents)}</span>
                {inv.stampDutyCents > 0 && <span className="cell-sub">bollo {euros(inv.stampDutyCents)}</span>}
              </td>
              <td style={{ whiteSpace: "nowrap" }} data-col="created">{dateTime(inv.createdAt)}</td>
              <td data-col="details">
                <Details inv={inv} />
              </td>
              {actions && <td data-col="actions">{actions(inv)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
