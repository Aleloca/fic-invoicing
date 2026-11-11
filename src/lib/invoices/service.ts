/**
 * Invoice lifecycle: create (idempotent), issue through FIC, retry.
 */
import { Prisma, type Invoice, type Tenant } from "@prisma/client";
import { env } from "../env";
import { ApiError } from "../errors";
import { createIssuedDocument, FicHttpError, sendEInvoice } from "../fic/client";
import { getFicAccess } from "../fic/tokens";
import {
  buildIssuedDocumentPayload,
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
    applyStampDuty: tenant.applyStampDuty,
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

function buildOrThrow(tenant: Tenant, payload: StoredRequestPayload, invoice: Pick<Invoice, "amountCents" | "description">, dryRun: boolean): BuiltPayload {
  try {
    return buildIssuedDocumentPayload(tenantInvoiceConfig(tenant), {
      customer: payload.customer,
      amountCents: invoice.amountCents,
      description: invoice.description,
      date: payload.date,
      dryRun,
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

function errorMessageOf(error: unknown): string {
  if (error instanceof FicHttpError || error instanceof ApiError) return error.message;
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
  const built = buildOrThrow(tenant, stored, input, dryRun);

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
 */
async function issue(tenant: Tenant, invoice: Invoice, stored: StoredRequestPayload): Promise<Invoice> {
  const dryRun = invoice.dryRun || tenant.dryRun;
  await prisma.invoice.update({ where: { id: invoice.id }, data: { attempts: { increment: 1 }, dryRun } });

  try {
    const built = buildOrThrow(tenant, stored, invoice, dryRun);
    const access = await getFicAccess(tenant.id);
    if (!access.companyId) throw new ApiError(409, "fic_not_connected", "No Fatture in Cloud company selected");

    const document = await createIssuedDocument(access.accessToken, access.companyId, built.body);
    const documentId = document.id && document.id > 0 ? document.id : null;
    const number =
      document.number !== null ? `${document.number}${document.numeration ?? tenant.numeration ?? ""}` : null;

    let sdiSentAt: Date | null = null;
    let sdiError: string | null = null;
    if (!dryRun && tenant.sendToSdi && documentId) {
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
        // The customer data is no longer needed once the document exists in FIC.
        ...(env.purgePayloadOnSuccess() ? { requestPayload: Prisma.DbNull } : {}),
      },
    });
  } catch (error) {
    if (!(error instanceof FicHttpError || error instanceof ApiError)) {
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
