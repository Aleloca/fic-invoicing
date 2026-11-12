import {
  confirmNotInFicAction,
  deleteAppleInvoiceAction,
  deleteInvoiceAction,
  retryAppleInvoiceAction,
  retryInvoiceAction,
} from "@/app/admin/actions";
import { isDeletable } from "@/lib/invoices/service";
import type { InvoiceRow } from "./invoice-table";
import { SubmitButton } from "@/components/submit-button";

/** Splits the `notice` query value set by the invoice actions into a success notice or an error. */
export function invoiceNotice(raw: string | undefined): { notice?: string; error?: string } {
  if (!raw) return {};
  if (raw.startsWith("retry_error")) {
    return { error: `Retry refused: ${raw.split(":").slice(2).join(":") || "unexpected error, check the server logs"}` };
  }
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
  owner,
  returnTo,
}: {
  inv: InvoiceRow;
  /** The project or the Apple account the invoice belongs to. */
  owner: { projectId: string } | { appleAccountId: string };
  returnTo: string;
}) {
  const retry =
    "projectId" in owner ? retryInvoiceAction.bind(null, owner.projectId, inv.id) : retryAppleInvoiceAction.bind(null, owner.appleAccountId, inv.id);
  const remove =
    "projectId" in owner ? deleteInvoiceAction.bind(null, owner.projectId, inv.id) : deleteAppleInvoiceAction.bind(null, owner.appleAccountId, inv.id);
  const sdiRetry = inv.status === "ISSUED" && inv.sdiError !== null && inv.sdiSentAt === null;
  const canRetry = inv.status === "FAILED" || sdiRetry;
  const canDelete = isDeletable(inv) && !inv.outcomeUnknown;
  const confirmNotThere = confirmNotInFicAction.bind(null, owner, inv.id);
  if (!canRetry && !canDelete) return null;
  return (
    <div className="row-actions">
      {canRetry && (
        <form action={retry}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <SubmitButton className="btn small">
            {sdiRetry ? "Resend to SDI" : inv.outcomeUnknown ? "Check and retry" : "Retry"}
          </SubmitButton>
        </form>
      )}
      {inv.outcomeUnknown && (
        <details className="confirm">
          <summary className="btn small secondary">Not in FIC</summary>
          <div className="confirm-box">
            <p>
              Only if you checked Fatture in Cloud and this invoice is not there. Then it can be deleted, or retried
              without looking for it.
            </p>
            <form action={confirmNotThere}>
              <input type="hidden" name="returnTo" value={returnTo} />
              <SubmitButton className="btn small">
                It is not there
              </SubmitButton>
            </form>
          </div>
        </details>
      )}
      {canDelete && (
        <details className="confirm">
          <summary className="btn small danger">Delete</summary>
          <div className="confirm-box">
            <p>{deleteWarning(inv)}</p>
            <form action={remove}>
              <input type="hidden" name="returnTo" value={returnTo} />
              <SubmitButton className="btn small danger solid">
                Confirm delete
              </SubmitButton>
            </form>
          </div>
        </details>
      )}
    </div>
  );
}
