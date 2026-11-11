import { deleteInvoiceAction, retryInvoiceAction } from "@/app/admin/actions";
import { isDeletable } from "@/lib/invoices/service";
import type { InvoiceRow } from "./invoice-table";

/** Splits the `notice` query value set by the invoice actions into a success notice or an error. */
export function invoiceNotice(raw: string | undefined): { notice?: string; error?: string } {
  if (!raw) return {};
  if (raw.startsWith("retry_error")) return { error: `Retry refused (${raw})` };
  if (raw.startsWith("delete_error")) {
    return {
      error: `Delete refused: ${raw.split(":").slice(2).join(":") || "unexpected error, check the server logs"}`,
    };
  }
  return { notice: raw };
}

function deleteWarning(inv: InvoiceRow): string {
  if (inv.ficDocumentId !== null) {
    return `Deletes document ${inv.ficNumber ?? `#${inv.ficDocumentId}`} from Fatture in Cloud. Deleting an invoice that is not the latest of its numeration leaves a gap in the numbering.`;
  }
  if (inv.dryRun && inv.status === "ISSUED") {
    return "This dry run has nothing in Fatture in Cloud: only this row is marked deleted.";
  }
  return "Nothing was created in Fatture in Cloud: only this row is marked deleted. Retrying will no longer be possible.";
}

export function InvoiceActions({
  inv,
  projectId,
  returnTo,
}: {
  inv: InvoiceRow;
  projectId: string;
  returnTo: string;
}) {
  const sdiRetry = inv.status === "ISSUED" && inv.sdiError !== null && inv.sdiSentAt === null;
  const canRetry = inv.status === "FAILED" || sdiRetry;
  const canDelete = isDeletable(inv);
  if (!canRetry && !canDelete) return null;
  return (
    <div className="row-actions">
      {canRetry && (
        <form action={retryInvoiceAction.bind(null, projectId, inv.id)}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <button type="submit" className="btn small">
            {sdiRetry ? "Resend to SDI" : "Retry"}
          </button>
        </form>
      )}
      {canDelete && (
        <details className="confirm">
          <summary className="btn small danger">Delete</summary>
          <div className="confirm-box">
            <p>{deleteWarning(inv)}</p>
            <form action={deleteInvoiceAction.bind(null, projectId, inv.id)}>
              <input type="hidden" name="returnTo" value={returnTo} />
              <button type="submit" className="btn small danger solid">
                Confirm delete
              </button>
            </form>
          </div>
        </details>
      )}
    </div>
  );
}
