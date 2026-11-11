import type { Invoice } from "@prisma/client";

export interface InvoiceDto {
  id: string;
  idempotencyKey: string;
  externalRef: string | null;
  status: Invoice["status"];
  customerCategory: Invoice["customerCategory"];
  number: string | null;
  ficDocumentId: number | null;
  amountCents: number;
  stampDutyCents: number;
  dryRun: boolean;
  errorMessage: string | null;
  attempts: number;
  sdi: { sentAt: string | null; error: string | null };
  /** Set when status is DELETED: the document was deleted from Fatture in Cloud by an admin. */
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toInvoiceDto(invoice: Invoice): InvoiceDto {
  return {
    id: invoice.id,
    idempotencyKey: invoice.idempotencyKey,
    externalRef: invoice.externalRef,
    status: invoice.status,
    customerCategory: invoice.customerCategory,
    number: invoice.ficNumber,
    ficDocumentId: invoice.ficDocumentId,
    amountCents: invoice.amountCents,
    stampDutyCents: invoice.stampDutyCents,
    dryRun: invoice.dryRun,
    errorMessage: invoice.errorMessage,
    attempts: invoice.attempts,
    sdi: { sentAt: invoice.sdiSentAt?.toISOString() ?? null, error: invoice.sdiError },
    deletedAt: invoice.deletedAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}
