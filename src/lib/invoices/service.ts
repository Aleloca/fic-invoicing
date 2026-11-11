/**
 * Invoice lifecycle: create (idempotent), issue through FIC, retry.
 */
import { Prisma, type Invoice, type Tenant } from "@prisma/client";
import { env } from "../env";
import { ApiError } from "../errors";
import {
  computeIssuedDocumentTotals,
  createIssuedDocument,
  deleteIssuedDocument,
  FicHttpError,
  sendEInvoice,
  type FicDocumentTotals,
} from "../fic/client";
import { getFicAccess } from "../fic/tokens";
import {
  buildIssuedDocumentPayload,
  centsToEuros,
  PayloadError,
  todayInItaly,
  type BuiltPayload,
  type CustomerData,
  type InvoiceConfig,
} from "../fiscal/payload";
import { parseStatementOverrides } from "../fiscal/statements";
import { prisma } from "../prisma";
import type { CreateInvoiceInput } from "./schema";

/** What is stored in `Invoice.requestPayload` to allow a retry. Contains personal data. */
export interface StoredRequestPayload {
  v: 1;
  customer: CustomerData;
  date: string;
}

export type CreateOutcome =
  | { kind: "existing"; invoice: Invoice }
  | { kind: "issued"; invoice: Invoice }
  | { kind: "failed"; invoice: Invoice };

export function tenantInvoiceConfig(tenant: Tenant): InvoiceConfig {
  return {
    fiscalRegime: tenant.fiscalRegime,
    vatTypeId: tenant.vatTypeId,
    nonTaxableVatTypeId: tenant.nonTaxableVatTypeId,
    paymentAccountId: tenant.paymentAccountId,
    paymentMethodId: tenant.paymentMethodId,
    numeration: tenant.numeration,
    itemCode: tenant.itemCode,
    statementOverrides: parseStatementOverrides(tenant.fiscalStatements),
    eiPaymentMethod: tenant.eiPaymentMethod,
    stampDutyMode: tenant.stampDutyMode,
    stampDutyVatTypeId: tenant.stampDutyVatTypeId,
  };
}

function assertTenantReady(tenant: Tenant): void {
  if (tenant.ficNeedsReconnect) {
    throw new ApiError(409, "fic_reconnect_required", "The Fatture in Cloud authorization must be renewed by an administrator");
  }
  if (!tenant.accessTokenEnc || !tenant.ficCompanyId) {
    throw new ApiError(409, "fic_not_connected", "This tenant is not connected to a Fatture in Cloud company yet");
  }
}

function buildOrThrow(tenant: Tenant, payload: StoredRequestPayload, invoice: Pick<Invoice, "amountCents" | "description">): BuiltPayload {
  try {
    return buildIssuedDocumentPayload(tenantInvoiceConfig(tenant), {
      customer: payload.customer,
      amountCents: invoice.amountCents,
      description: invoice.description,
      date: payload.date,
    });
  } catch (error) {
    if (error instanceof PayloadError) {
      throw error.kind === "config"
        ? new ApiError(409, "tenant_not_configured", error.message)
        : new ApiError(422, "validation_error", error.message);
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** The FIC totals pre-check rejected the document: nothing was created in FIC. */
export class TotalsCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TotalsCheckError";
  }
}

/** Tolerance when comparing euro amounts returned by FIC. */
const EURO_TOLERANCE = 0.005;

const formatEuros = (value: number) => `€${value.toFixed(2)}`;

/**
 * FIC refuses to create a document whose payments do not add up to the amount due
 * ("Il totale dei pagamenti non corrisponde al totale da pagare"). Check it on the
 * totals computed by FIC before creating anything.
 */
export function assertPaymentsMatchTotals(totals: FicDocumentTotals, built: BuiltPayload): void {
  if (totals.amountDue === null) {
    throw new TotalsCheckError("Fatture in Cloud totals check returned no amount_due: nothing was created in Fatture in Cloud");
  }
  const paid = totals.paymentsSum ?? centsToEuros(built.totalPaidCents);
  if (Math.abs(paid - totals.amountDue) > EURO_TOLERANCE) {
    throw new TotalsCheckError(
      `Payments total ${formatEuros(paid)} does not match the amount due ${formatEuros(totals.amountDue)} ` +
        "computed by Fatture in Cloud: nothing was created in Fatture in Cloud",
    );
  }
}

function errorMessageOf(error: unknown): string {
  if (error instanceof FicHttpError || error instanceof ApiError || error instanceof TotalsCheckError) return error.message;
  if (error instanceof Error) return `Unexpected error: ${error.message}`;
  return "Unexpected error";
}

/**
 * Creates and issues an invoice. Same tenant + idempotencyKey returns the
 * existing row untouched (whatever its status).
 */
export async function createInvoice(tenant: Tenant, input: CreateInvoiceInput): Promise<CreateOutcome> {
  const existing = await prisma.invoice.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: tenant.id, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) return { kind: "existing", invoice: existing };

  assertTenantReady(tenant);

  // Callers may force a dry run, never turn off the tenant's dry run.
  const dryRun = tenant.dryRun || input.dryRun === true;
  const stored: StoredRequestPayload = { v: 1, customer: input.customer, date: input.paidAt ?? todayInItaly() };
  // Fail fast on configuration / input problems, before writing anything.
  const built = buildOrThrow(tenant, stored, input);

  let invoice: Invoice;
  try {
    // PENDING row first: if the process dies mid-call there is a trace.
    invoice = await prisma.invoice.create({
      data: {
        tenantId: tenant.id,
        idempotencyKey: input.idempotencyKey,
        externalRef: input.externalRef ?? null,
        status: "PENDING",
        customerCategory: input.customer.category,
        amountCents: input.amountCents,
        stampDutyCents: built.stampDutyCents,
        description: input.description,
        dryRun,
        requestPayload: stored as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Lost a race with a concurrent request using the same key.
      const winner = await prisma.invoice.findUniqueOrThrow({
        where: { tenantId_idempotencyKey: { tenantId: tenant.id, idempotencyKey: input.idempotencyKey } },
      });
      return { kind: "existing", invoice: winner };
    }
    throw error;
  }

  const issued = await issue(tenant, invoice, stored);
  return { kind: issued.status === "ISSUED" ? "issued" : "failed", invoice: issued };
}

/**
 * Calls FIC for a PENDING invoice and records the outcome (ISSUED or FAILED).
 * Never throws for FIC / token problems: they end up in `errorMessage`.
 *
 * Every attempt first asks FIC to compute the totals (nothing is created, no number
 * is consumed). A dry run stops there: FIC has no real dry run on creation.
 */
async function issue(tenant: Tenant, invoice: Invoice, stored: StoredRequestPayload): Promise<Invoice> {
  const dryRun = invoice.dryRun || tenant.dryRun;
  await prisma.invoice.update({ where: { id: invoice.id }, data: { attempts: { increment: 1 }, dryRun } });
  // The customer data is no longer needed once the outcome is final.
  const purge = env.purgePayloadOnSuccess() ? { requestPayload: Prisma.DbNull } : {};

  try {
    const built = buildOrThrow(tenant, stored, invoice);
    const access = await getFicAccess(tenant.id);
    if (!access.companyId) throw new ApiError(409, "fic_not_connected", "No Fatture in Cloud company selected");

    const totals = await computeIssuedDocumentTotals(access.accessToken, access.companyId, built.body);
    assertPaymentsMatchTotals(totals, built);

    if (dryRun) {
      return await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "ISSUED",
          ficDocumentId: null,
          ficNumber: null,
          stampDutyCents: built.stampDutyCents,
          errorMessage: null,
          sdiSentAt: null,
          sdiError: null,
          ...purge,
        },
      });
    }

    const document = await createIssuedDocument(access.accessToken, access.companyId, built.body);
    const documentId = document.id && document.id > 0 ? document.id : null;
    const number =
      document.number !== null ? `${document.number}${document.numeration ?? tenant.numeration ?? ""}` : null;

    let sdiSentAt: Date | null = null;
    let sdiError: string | null = null;
    if (tenant.sendToSdi && documentId) {
      try {
        await sendEInvoice(access.accessToken, access.companyId, documentId);
        sdiSentAt = new Date();
      } catch (error) {
        sdiError = errorMessageOf(error);
      }
    }

    return await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "ISSUED",
        ficDocumentId: documentId,
        ficNumber: number,
        stampDutyCents: built.stampDutyCents,
        errorMessage: null,
        sdiSentAt,
        sdiError,
        ...purge,
      },
    });
  } catch (error) {
    if (!(error instanceof FicHttpError || error instanceof ApiError || error instanceof TotalsCheckError)) {
      console.error("[fic-invoicing] unexpected error while issuing invoice", invoice.id, error);
    }
    return prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "FAILED", errorMessage: errorMessageOf(error) },
    });
  }
}

export async function findTenantInvoice(tenantId: string, id: string): Promise<Invoice> {
  const invoice = await prisma.invoice.findFirst({ where: { id, tenantId } });
  if (!invoice) throw new ApiError(404, "not_found", "Invoice not found");
  return invoice;
}

/**
 * Retries an invoice:
 * - FAILED: issues it again with the current tenant configuration;
 * - ISSUED whose SDI send failed: retries only the SDI send.
 */
export async function retryInvoice(tenant: Tenant, id: string): Promise<Invoice> {
  const invoice = await findTenantInvoice(tenant.id, id);

  if (invoice.status === "DELETED") {
    throw new ApiError(409, "conflict", "This invoice was deleted from Fatture in Cloud: it cannot be retried");
  }
  if (invoice.status === "ISSUED" && invoice.sdiError && !invoice.sdiSentAt && invoice.ficDocumentId) {
    return retrySdiSend(tenant, invoice);
  }
  if (invoice.status !== "FAILED") {
    throw new ApiError(409, "conflict", `Only FAILED invoices can be retried (status is ${invoice.status})`);
  }
  if (!invoice.requestPayload) {
    throw new ApiError(409, "conflict", "The request payload of this invoice was purged: it cannot be retried");
  }
  assertTenantReady(tenant);

  // Claim the row atomically so two concurrent retries cannot both call FIC.
  const claimed = await prisma.invoice.updateMany({
    where: { id: invoice.id, tenantId: tenant.id, status: "FAILED" },
    data: { status: "PENDING", errorMessage: null },
  });
  if (claimed.count !== 1) throw new ApiError(409, "conflict", "This invoice is already being retried");

  const fresh = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  return issue(tenant, fresh, invoice.requestPayload as unknown as StoredRequestPayload);
}

async function retrySdiSend(tenant: Tenant, invoice: Invoice): Promise<Invoice> {
  try {
    const access = await getFicAccess(tenant.id);
    if (!access.companyId) throw new ApiError(409, "fic_not_connected", "No Fatture in Cloud company selected");
    await sendEInvoice(access.accessToken, access.companyId, invoice.ficDocumentId!);
    return prisma.invoice.update({
      where: { id: invoice.id },
      data: { sdiSentAt: new Date(), sdiError: null },
    });
  } catch (error) {
    return prisma.invoice.update({ where: { id: invoice.id }, data: { sdiError: errorMessageOf(error) } });
  }
}

/** Whether an invoice can be deleted from Fatture in Cloud: a real document not sent to SDI. */
export function isDeletable(invoice: Pick<Invoice, "status" | "ficDocumentId" | "sdiSentAt">): boolean {
  return invoice.status === "ISSUED" && invoice.ficDocumentId !== null && invoice.sdiSentAt === null;
}

/**
 * Deletes the invoice's document from Fatture in Cloud and marks the row DELETED.
 * The row, number and document id are kept for audit. A FIC 404 counts as already deleted.
 * Deleting an invoice that is not the latest of its numeration leaves a gap in the numbering.
 */
export async function deleteInvoice(tenant: Tenant, id: string): Promise<Invoice> {
  const invoice = await findTenantInvoice(tenant.id, id);
  if (invoice.status === "DELETED") return invoice;
  if (invoice.status !== "ISSUED" || invoice.ficDocumentId === null) {
    throw new ApiError(409, "conflict", "Only issued invoices with a document in Fatture in Cloud can be deleted");
  }
  if (invoice.sdiSentAt !== null) {
    throw new ApiError(409, "conflict", "This invoice was sent to SDI: it cannot be deleted, issue a credit note instead");
  }
  assertTenantReady(tenant);

  const access = await getFicAccess(tenant.id);
  if (!access.companyId) throw new ApiError(409, "fic_not_connected", "No Fatture in Cloud company selected");
  try {
    await deleteIssuedDocument(access.accessToken, access.companyId, invoice.ficDocumentId);
  } catch (error) {
    if (error instanceof FicHttpError) throw new ApiError(502, "fic_error", error.message);
    throw error;
  }

  return prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: "DELETED", deletedAt: new Date() },
  });
}
