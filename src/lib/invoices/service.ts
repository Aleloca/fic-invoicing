/**
 * Invoice lifecycle: create (idempotent), issue through FIC, retry.
 */
import { Prisma, type Invoice } from "@prisma/client";
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
} from "../fiscal/payload";
import { prisma } from "../prisma";
import { resolveConfig, type CompanyWithAccount, type ProjectWithCompany } from "../projects/config";
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

/** The company a project issues from, once it is usable. Throws the public API errors otherwise. */
function assertProjectReady(project: ProjectWithCompany): CompanyWithAccount {
  const company = project.company;
  if (!company) {
    throw new ApiError(409, "fic_not_connected", "This project has no Fatture in Cloud company yet");
  }
  return assertCompanyReady(company);
}

function assertCompanyReady(company: CompanyWithAccount): CompanyWithAccount {
  if (company.account.needsReconnect) {
    throw new ApiError(409, "fic_reconnect_required", "The Fatture in Cloud authorization must be renewed by an administrator");
  }
  if (!company.account.accessTokenEnc || !company.account.refreshTokenEnc) {
    throw new ApiError(409, "fic_not_connected", "The Fatture in Cloud account of this project is not connected");
  }
  return company;
}

/**
 * The company an existing invoice belongs to: the one that issued it, even if the project has
 * moved to another company since. Falls back to the project's company for older rows.
 */
export async function companyOfInvoice(project: ProjectWithCompany, invoice: Invoice): Promise<CompanyWithAccount> {
  if (!invoice.companyId || invoice.companyId === project.companyId) return assertProjectReady(project);
  const company = await prisma.company.findUnique({ where: { id: invoice.companyId }, include: { account: true } });
  if (!company) throw new ApiError(409, "fic_not_connected", "The Fatture in Cloud company that issued this invoice was removed");
  return assertCompanyReady(company);
}

function buildOrThrow(
  project: ProjectWithCompany,
  payload: StoredRequestPayload,
  invoice: Pick<Invoice, "amountCents" | "description">,
): BuiltPayload {
  try {
    return buildIssuedDocumentPayload(resolveConfig(project.company, project).invoice, {
      customer: payload.customer,
      amountCents: invoice.amountCents,
      description: invoice.description,
      date: payload.date,
    });
  } catch (error) {
    if (error instanceof PayloadError) {
      // The public code keeps its historical name: projects used to be called tenants.
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
 * Creates and issues an invoice. Same project + idempotencyKey returns the
 * existing row untouched (whatever its status).
 */
export async function createInvoice(project: ProjectWithCompany, input: CreateInvoiceInput): Promise<CreateOutcome> {
  const existing = await prisma.invoice.findUnique({
    where: { projectId_idempotencyKey: { projectId: project.id, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) return { kind: "existing", invoice: existing };

  assertProjectReady(project);

  // Callers may force a dry run, never turn off the project's dry run.
  const dryRun = project.dryRun || input.dryRun === true;
  const stored: StoredRequestPayload = { v: 1, customer: input.customer, date: input.paidAt ?? todayInItaly() };
  // Fail fast on configuration / input problems, before writing anything.
  const built = buildOrThrow(project, stored, input);

  let invoice: Invoice;
  try {
    // PENDING row first: if the process dies mid-call there is a trace.
    invoice = await prisma.invoice.create({
      data: {
        projectId: project.id,
        companyId: project.companyId,
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
        where: { projectId_idempotencyKey: { projectId: project.id, idempotencyKey: input.idempotencyKey } },
      });
      return { kind: "existing", invoice: winner };
    }
    throw error;
  }

  const issued = await issue(project, invoice, stored);
  return { kind: issued.status === "ISSUED" ? "issued" : "failed", invoice: issued };
}

/**
 * Calls FIC for a PENDING invoice and records the outcome (ISSUED or FAILED).
 * Never throws for FIC / token problems: they end up in `errorMessage`.
 *
 * Every attempt first asks FIC to compute the totals (nothing is created, no number
 * is consumed). A dry run stops there: FIC has no real dry run on creation.
 */
async function issue(project: ProjectWithCompany, invoice: Invoice, stored: StoredRequestPayload): Promise<Invoice> {
  const dryRun = invoice.dryRun || project.dryRun;
  // A retry issues from the project's current company: record it.
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { attempts: { increment: 1 }, dryRun, companyId: project.companyId },
  });
  // The customer data is no longer needed once the outcome is final.
  const purge = env.purgePayloadOnSuccess() ? { requestPayload: Prisma.DbNull } : {};

  try {
    const company = assertProjectReady(project);
    const config = resolveConfig(company, project);
    const built = buildOrThrow(project, stored, invoice);
    const token = await getFicAccess(company.accountId);

    const totals = await computeIssuedDocumentTotals(token, company.ficCompanyId, built.body);
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

    const document = await createIssuedDocument(token, company.ficCompanyId, built.body);
    const documentId = document.id && document.id > 0 ? document.id : null;
    const number =
      document.number !== null ? `${document.number}${document.numeration ?? config.invoice.numeration ?? ""}` : null;

    let sdiSentAt: Date | null = null;
    let sdiError: string | null = null;
    if (config.sendToSdi && documentId) {
      try {
        await sendEInvoice(token, company.ficCompanyId, documentId);
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

export async function findProjectInvoice(projectId: string, id: string): Promise<Invoice> {
  const invoice = await prisma.invoice.findFirst({ where: { id, projectId } });
  if (!invoice) throw new ApiError(404, "not_found", "Invoice not found");
  return invoice;
}

/**
 * Retries an invoice:
 * - FAILED: issues it again with the project's current company and settings;
 * - ISSUED whose SDI send failed: retries only the SDI send.
 */
export async function retryInvoice(project: ProjectWithCompany, id: string): Promise<Invoice> {
  const invoice = await findProjectInvoice(project.id, id);

  if (invoice.status === "DELETED") {
    throw new ApiError(409, "conflict", "This invoice was deleted from Fatture in Cloud: it cannot be retried");
  }
  if (invoice.status === "ISSUED" && invoice.sdiError && !invoice.sdiSentAt && invoice.ficDocumentId) {
    return retrySdiSend(project, invoice);
  }
  if (invoice.status !== "FAILED") {
    throw new ApiError(409, "conflict", `Only FAILED invoices can be retried (status is ${invoice.status})`);
  }
  if (!invoice.requestPayload) {
    throw new ApiError(409, "conflict", "The request payload of this invoice was purged: it cannot be retried");
  }
  assertProjectReady(project);

  // Claim the row atomically so two concurrent retries cannot both call FIC.
  const claimed = await prisma.invoice.updateMany({
    where: { id: invoice.id, projectId: project.id, status: "FAILED" },
    data: { status: "PENDING", errorMessage: null },
  });
  if (claimed.count !== 1) throw new ApiError(409, "conflict", "This invoice is already being retried");

  const fresh = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  return issue(project, fresh, invoice.requestPayload as unknown as StoredRequestPayload);
}

async function retrySdiSend(project: ProjectWithCompany, invoice: Invoice): Promise<Invoice> {
  try {
    const company = await companyOfInvoice(project, invoice);
    const token = await getFicAccess(company.accountId);
    await sendEInvoice(token, company.ficCompanyId, invoice.ficDocumentId!);
    return prisma.invoice.update({
      where: { id: invoice.id },
      data: { sdiSentAt: new Date(), sdiError: null },
    });
  } catch (error) {
    return prisma.invoice.update({ where: { id: invoice.id }, data: { sdiError: errorMessageOf(error) } });
  }
}

/**
 * Whether an admin can delete an invoice: anything not sent to SDI, except rows still
 * being processed (PENDING) and rows already deleted.
 */
export function isDeletable(invoice: Pick<Invoice, "status" | "sdiSentAt">): boolean {
  return (invoice.status === "ISSUED" || invoice.status === "FAILED") && invoice.sdiSentAt === null;
}

/**
 * Deletes an invoice and marks the row DELETED. When a document exists in Fatture in Cloud
 * it is deleted there first (a FIC 404 counts as already deleted); dry runs and failed
 * invoices have no document, so only the row changes. The row, number and document id are
 * kept for audit. Deleting an invoice that is not the latest of its numeration leaves a gap
 * in the numbering.
 */
export async function deleteInvoice(project: ProjectWithCompany, id: string): Promise<Invoice> {
  const invoice = await findProjectInvoice(project.id, id);
  if (invoice.status === "DELETED") return invoice;
  if (invoice.sdiSentAt !== null) {
    throw new ApiError(409, "conflict", "This invoice was sent to SDI: it cannot be deleted, issue a credit note instead");
  }
  if (invoice.status === "PENDING") {
    throw new ApiError(409, "conflict", "This invoice is still being processed: wait until it is issued or failed");
  }

  if (invoice.ficDocumentId !== null) {
    const company = await companyOfInvoice(project, invoice);
    const token = await getFicAccess(company.accountId);
    try {
      await deleteIssuedDocument(token, company.ficCompanyId, invoice.ficDocumentId);
    } catch (error) {
      if (error instanceof FicHttpError) throw new ApiError(502, "fic_error", error.message);
      throw error;
    }
  }

  return prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: "DELETED", deletedAt: new Date() },
  });
}
