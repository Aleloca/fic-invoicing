/**
 * Invoice lifecycle: create (idempotent), issue through FIC, retry.
 */
import { Prisma, type AppleAccount, type Invoice } from "@prisma/client";
import { env } from "../env";
import { ApiError } from "../errors";
import {
  computeIssuedDocumentTotals,
  createIssuedDocument,
  deleteIssuedDocument,
  FicHttpError,
  findIssuedDocumentBySubject,
  type FicCreatedDocument,
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
import { buildAppStorePayload, totalCents, type AppStoreInvoiceInput } from "../appstore/payload";
import { prisma } from "../prisma";
import { NO_OVERRIDES, resolveConfig, type CompanyWithAccount, type ProjectWithCompany } from "../projects/config";
import type { CreateInvoiceInput } from "./schema";

/** What is stored in `Invoice.requestPayload` to allow a retry. Contains personal data. */
export interface StoredRequestPayload {
  v: 1;
  customer: CustomerData;
  date: string;
}

/** What an invoice to Apple stores in `Invoice.requestPayload`: enough to rebuild it on retry. */
export interface AppStoreRequestPayload extends AppStoreInvoiceInput {
  v: 1;
  kind: "appstore";
  reportId: string;
}

function isAppStorePayload(value: unknown): value is AppStoreRequestPayload {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "appstore";
}


export type CreateOutcome =
  | { kind: "existing"; invoice: Invoice }
  | { kind: "issued"; invoice: Invoice }
  | { kind: "failed"; invoice: Invoice };

export type AppleAccountWithCompany = AppleAccount & { company: CompanyWithAccount | null };

/** Prisma `include` that loads what issuing an invoice to Apple needs. */
export const APPLE_ACCOUNT_INCLUDE = { company: { include: { account: true } } } satisfies Prisma.AppleAccountInclude;

/**
 * Who issues an invoice: a project (its own invoices) or an Apple account (the invoices to Apple,
 * one per report, covering several projects). Both issue from a Fatture in Cloud company.
 */
interface Issuer {
  scope: { projectId: string } | { appleAccountId: string };
  company: CompanyWithAccount | null;
  dryRun: boolean;
  numeration: string | null;
  sendToSdi: boolean;
}

export function projectIssuer(project: ProjectWithCompany): Issuer {
  const resolved = resolveConfig(project.company, project);
  return {
    scope: { projectId: project.id },
    company: project.company,
    dryRun: project.dryRun,
    numeration: resolved.invoice.numeration,
    sendToSdi: resolved.sendToSdi,
  };
}

/** Invoices to Apple follow the defaults of the account's company, and the account's dry run. */
export function appleIssuer(account: AppleAccountWithCompany): Issuer {
  const resolved = resolveConfig(account.company, NO_OVERRIDES);
  return {
    scope: { appleAccountId: account.id },
    company: account.company,
    dryRun: account.dryRun,
    numeration: resolved.invoice.numeration,
    sendToSdi: resolved.sendToSdi,
  };
}

/** The company an issuer issues from, once it is usable. Throws the public API errors otherwise. */
function assertIssuerReady(issuer: Pick<Issuer, "company">): CompanyWithAccount {
  if (!issuer.company) {
    throw new ApiError(409, "fic_not_connected", "No Fatture in Cloud company is set to issue these invoices");
  }
  return assertCompanyReady(issuer.company);
}

function assertProjectReady(project: ProjectWithCompany): CompanyWithAccount {
  return assertIssuerReady(project);
}

function assertCompanyReady(company: CompanyWithAccount): CompanyWithAccount {
  if (company.account.needsReconnect) {
    throw new ApiError(409, "fic_reconnect_required", "The Fatture in Cloud authorization must be renewed by an administrator");
  }
  if (!company.account.accessTokenEnc || !company.account.refreshTokenEnc) {
    throw new ApiError(409, "fic_not_connected", "The Fatture in Cloud account of this company is not connected");
  }
  return company;
}

/**
 * The company an existing invoice belongs to: the one that issued it, even if the issuer has
 * moved to another company since. Falls back to the issuer's company for older rows.
 */
async function companyOfInvoiceFor(issuer: Pick<Issuer, "company">, invoice: Invoice): Promise<CompanyWithAccount> {
  if (!invoice.companyId || invoice.companyId === issuer.company?.id) return assertIssuerReady(issuer);
  const company = await prisma.company.findUnique({ where: { id: invoice.companyId }, include: { account: true } });
  if (!company) throw new ApiError(409, "fic_not_connected", "The Fatture in Cloud company that issued this invoice was removed");
  return assertCompanyReady(company);
}

export function companyOfInvoice(project: ProjectWithCompany, invoice: Invoice): Promise<CompanyWithAccount> {
  return companyOfInvoiceFor(project, invoice);
}

function buildOrThrow(
  project: ProjectWithCompany,
  payload: StoredRequestPayload,
  invoice: Pick<Invoice, "amountCents" | "description">,
): BuiltPayload {
  return payloadOrThrow(() =>
    buildIssuedDocumentPayload(resolveConfig(project.company, project).invoice, {
      customer: payload.customer,
      amountCents: invoice.amountCents,
      description: invoice.description,
      date: payload.date,
    }),
  );
}

function applePayload(account: AppleAccountWithCompany, payload: AppStoreInvoiceInput): BuiltPayload {
  return payloadOrThrow(() => buildAppStorePayload(account, resolveConfig(account.company, NO_OVERRIDES).invoice, payload));
}

function payloadOrThrow(build: () => BuiltPayload): BuiltPayload {
  try {
    return build();
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

  const issued = await issue(projectIssuer(project), invoice, () => buildOrThrow(project, stored, invoice));
  return { kind: issued.status === "ISSUED" ? "issued" : "failed", invoice: issued };
}


/**
 * Calls FIC for a PENDING invoice and records the outcome (ISSUED or FAILED).
 * Never throws for FIC / token problems: they end up in `errorMessage`.
 *
 * Every attempt first asks FIC to compute the totals (nothing is created, no number
 * is consumed). A dry run stops there: FIC has no real dry run on creation.
 */
async function issue(issuer: Issuer, invoice: Invoice, build: () => BuiltPayload): Promise<Invoice> {
  const dryRun = invoice.dryRun || issuer.dryRun;
  // A retry issues from the issuer's current company: record it.
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { attempts: { increment: 1 }, dryRun, companyId: issuer.company?.id ?? null },
  });
  // The customer data is no longer needed once the outcome is final.
  const purge = env.purgePayloadOnSuccess() ? { requestPayload: Prisma.DbNull } : {};
  let creating = false;
  let document: FicCreatedDocument | null = null;

  try {
    const company = assertIssuerReady(issuer);
    const built = withMarker(build(), invoice.id);
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
          outcomeUnknown: false,
          sdiSentAt: null,
          sdiError: null,
          ...purge,
        },
      });
    }

    creating = true;
    document = await createIssuedDocument(token, company.ficCompanyId, built.body);
    creating = false;
    const documentId = document.id && document.id > 0 ? document.id : null;

    let sdiSentAt: Date | null = null;
    let sdiError: string | null = null;
    if (issuer.sendToSdi && documentId) {
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
        ...issuedFields(document, issuer),
        stampDutyCents: built.stampDutyCents,
        sdiSentAt,
        sdiError,
        ...purge,
      },
    });
  } catch (error) {
    if (!(error instanceof FicHttpError || error instanceof ApiError || error instanceof TotalsCheckError)) {
      console.error("[fic-invoicing] unexpected error while issuing invoice", invoice.id, error);
    }
    // The document exists in FIC: whatever failed afterwards, the invoice is issued.
    if (document) {
      return prisma.invoice.update({ where: { id: invoice.id }, data: issuedFields(document, issuer) });
    }
    // A refusal (4xx) means nothing was created. A timeout, a network error or a 5xx while creating
    // does not tell: FIC may have saved the document, so a retry must look for it first.
    const unknown = creating && !isRejection(error);
    return prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "FAILED",
        outcomeUnknown: unknown,
        errorMessage: errorMessageOf(error),
      },
    });
  }
}

/** A definite refusal from FIC: the document was not created. */
function isRejection(error: unknown): boolean {
  return error instanceof FicHttpError && error.status >= 400 && error.status < 500 && error.status !== 408;
}

/** The internal subject (not printed) that lets a retry find the FIC document of an invoice. */
export function invoiceMarker(invoiceId: string): string {
  return `fic-invoicing:${invoiceId}`;
}

function withMarker(built: BuiltPayload, invoiceId: string): BuiltPayload {
  return { ...built, body: { ...built.body, data: { ...built.body.data, subject: invoiceMarker(invoiceId) } } };
}

function issuedFields(document: FicCreatedDocument, issuer: Issuer) {
  const documentId = document.id && document.id > 0 ? document.id : null;
  return {
    status: "ISSUED" as const,
    ficDocumentId: documentId,
    ficNumber: document.number !== null ? `${document.number}${document.numeration ?? issuer.numeration ?? ""}` : null,
    errorMessage: null,
    outcomeUnknown: false,
  };
}

/** A PENDING row older than this was abandoned (the process stopped mid-call). */
const STALE_PENDING_MS = 10 * 60 * 1000;
/** Marks a PENDING row that is being deleted, with the status to go back to. */
const DELETING = "deleting:";

/**
 * Releases rows left PENDING by a process that stopped: an issue becomes FAILED with an unknown
 * outcome (a retry looks for the document in FIC first), an interrupted delete goes back to its
 * previous status (deleting again is safe: FIC answers 404 for a document already gone).
 */
export async function recoverStalePending(now: Date = new Date()): Promise<number> {
  const before = new Date(now.getTime() - STALE_PENDING_MS);
  const stale = await prisma.invoice.findMany({
    where: { status: "PENDING", updatedAt: { lt: before } },
    select: { id: true, errorMessage: true, updatedAt: true },
  });
  let recovered = 0;
  for (const row of stale) {
    const deleting = row.errorMessage?.startsWith(DELETING) ? row.errorMessage.slice(DELETING.length) : null;
    const data: Prisma.InvoiceUpdateManyMutationInput =
      deleting === "ISSUED" || deleting === "FAILED"
        ? { status: deleting, errorMessage: null }
        : {
            status: "FAILED",
            outcomeUnknown: true,
            errorMessage: "The service stopped while this invoice was being issued",
          };
    // Only if nobody touched it meanwhile.
    const { count } = await prisma.invoice.updateMany({
      where: { id: row.id, status: "PENDING", updatedAt: row.updatedAt },
      data,
    });
    recovered += count;
  }
  return recovered;
}

/**
 * Looks in FIC for the document of an invoice whose outcome is unknown. Found: the invoice is
 * recorded as ISSUED. Not found: the outcome is cleared, so it can be issued again.
 */
async function resolveUnknownOutcome(issuer: Issuer, invoice: Invoice): Promise<Invoice> {
  const company = assertIssuerReady(issuer);
  const token = await getFicAccess(company.accountId);
  const found = await findIssuedDocumentBySubject(token, company.ficCompanyId, invoiceMarker(invoice.id));
  if (!found) return prisma.invoice.update({ where: { id: invoice.id }, data: { outcomeUnknown: false } });
  const purge = env.purgePayloadOnSuccess() ? { requestPayload: Prisma.DbNull } : {};
  return prisma.invoice.update({
    where: { id: invoice.id },
    data: { ...issuedFields({ ...found, amountDue: null }, issuer), sdiSentAt: null, sdiError: null, ...purge },
  });
}

async function findInvoice(scope: Issuer["scope"], id: string): Promise<Invoice> {
  const invoice = await prisma.invoice.findFirst({ where: { id, ...scope } });
  if (!invoice) throw new ApiError(404, "not_found", "Invoice not found");
  return invoice;
}

export function findProjectInvoice(projectId: string, id: string): Promise<Invoice> {
  return findInvoice({ projectId }, id);
}

/**
 * Retries an invoice:
 * - FAILED: issues it again with the issuer's current company and settings;
 * - ISSUED whose SDI send failed: retries only the SDI send.
 */
async function retryWith(
  issuer: Issuer,
  id: string,
  builderFor: (payload: Prisma.JsonValue, invoice: Invoice) => () => BuiltPayload,
): Promise<Invoice> {
  await recoverStalePending();
  const invoice = await findInvoice(issuer.scope, id);

  if (invoice.status === "DELETED") {
    throw new ApiError(409, "conflict", "This invoice was deleted from Fatture in Cloud: it cannot be retried");
  }
  if (invoice.status === "ISSUED" && invoice.sdiError && !invoice.sdiSentAt && invoice.ficDocumentId) {
    return retrySdiSend(issuer, invoice);
  }
  if (invoice.status !== "FAILED") {
    throw new ApiError(409, "conflict", `Only FAILED invoices can be retried (status is ${invoice.status})`);
  }
  if (!invoice.requestPayload) {
    throw new ApiError(409, "conflict", "The request payload of this invoice was purged: it cannot be retried");
  }
  assertIssuerReady(issuer);
  const build = builderFor(invoice.requestPayload, invoice);

  // Claim the row atomically so two concurrent retries cannot both call FIC.
  const claimed = await prisma.invoice.updateMany({
    where: { id: invoice.id, ...issuer.scope, status: "FAILED" },
    data: { status: "PENDING", errorMessage: null },
  });
  if (claimed.count !== 1) throw new ApiError(409, "conflict", "This invoice is already being retried");

  let fresh = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  if (fresh.outcomeUnknown) {
    try {
      fresh = await resolveUnknownOutcome(issuer, fresh);
    } catch (error) {
      // Could not tell: leave it as it was, never create a second document blindly.
      await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "FAILED" } });
      throw new ApiError(
        502,
        "fic_error",
        `Could not check whether Fatture in Cloud already created this invoice: ${errorMessageOf(error)}`,
      );
    }
    if (fresh.status === "ISSUED") {
      await markAppStoreReport(fresh);
      return fresh;
    }
  }
  const issued = await issue(issuer, fresh, build);
  await markAppStoreReport(issued);
  return issued;
}

export function retryInvoice(project: ProjectWithCompany, id: string): Promise<Invoice> {
  return retryWith(projectIssuer(project), id, (payload, invoice) => {
    if (isAppStorePayload(payload)) {
      throw new ApiError(409, "conflict", "This invoice to Apple was made before Apple accounts: delete it and issue it again from the Apple page");
    }
    return () => buildOrThrow(project, payload as unknown as StoredRequestPayload, invoice);
  });
}

export function retryAppleInvoice(account: AppleAccountWithCompany, id: string): Promise<Invoice> {
  return retryWith(appleIssuer(account), id, (payload) => {
    if (!isAppStorePayload(payload)) throw new ApiError(409, "conflict", "Not an invoice to Apple");
    return () => applePayload(account, payload);
  });
}

async function retrySdiSend(issuer: Issuer, invoice: Invoice): Promise<Invoice> {
  try {
    const company = await companyOfInvoiceFor(issuer, invoice);
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
async function deleteWith(issuer: Issuer, id: string): Promise<Invoice> {
  await recoverStalePending();
  const invoice = await findInvoice(issuer.scope, id);
  if (invoice.status === "DELETED") return invoice;
  if (invoice.sdiSentAt !== null) {
    throw new ApiError(409, "conflict", "This invoice was sent to SDI: it cannot be deleted, issue a credit note instead");
  }
  if (invoice.status === "PENDING") {
    throw new ApiError(409, "conflict", "This invoice is still being processed: wait until it is issued or failed");
  }
  if (invoice.outcomeUnknown) {
    throw new ApiError(
      409,
      "conflict",
      "Fatture in Cloud may have created this invoice: retry it first (it looks for the document there), or confirm it is not there",
    );
  }
  const previous = invoice.status as "ISSUED" | "FAILED";

  // Claim the row, so a concurrent retry or delete cannot run on it meanwhile.
  const claimed = await prisma.invoice.updateMany({
    where: { id: invoice.id, ...issuer.scope, status: previous, sdiSentAt: null, outcomeUnknown: false },
    data: { status: "PENDING", errorMessage: `${DELETING}${previous}` },
  });
  if (claimed.count !== 1) throw new ApiError(409, "conflict", "This invoice changed meanwhile: reload and try again");
  const release = () =>
    prisma.invoice.update({ where: { id: invoice.id }, data: { status: previous, errorMessage: invoice.errorMessage } });

  if (invoice.ficDocumentId !== null) {
    try {
      const company = await companyOfInvoiceFor(issuer, invoice);
      const token = await getFicAccess(company.accountId);
      await deleteIssuedDocument(token, company.ficCompanyId, invoice.ficDocumentId);
    } catch (error) {
      await release();
      if (error instanceof FicHttpError) throw new ApiError(502, "fic_error", error.message);
      throw error;
    }
  }

  const deleted = await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: "DELETED", deletedAt: new Date(), errorMessage: invoice.errorMessage },
  });
  // An App Store report whose invoice is deleted can be invoiced again.
  await prisma.appStoreReport.updateMany({ where: { invoiceId: invoice.id }, data: { status: "READY", invoiceId: null } });
  return deleted;
}

/** The admin checked Fatture in Cloud by hand: the invoice is not there, so it can be retried or deleted. */
export async function confirmNotInFic(where: Issuer["scope"], id: string): Promise<Invoice> {
  const invoice = await findInvoice(where, id);
  if (!invoice.outcomeUnknown) return invoice;
  return prisma.invoice.update({ where: { id: invoice.id }, data: { outcomeUnknown: false } });
}

export function deleteInvoice(project: ProjectWithCompany, id: string): Promise<Invoice> {
  return deleteWith(projectIssuer(project), id);
}

export function deleteAppleInvoice(account: AppleAccountWithCompany, id: string): Promise<Invoice> {
  return deleteWith(appleIssuer(account), id);
}

/** An App Store report is INVOICED once its invoice is issued. */
async function markAppStoreReport(invoice: Invoice): Promise<void> {
  if (invoice.status !== "ISSUED") return;
  await prisma.appStoreReport.updateMany({ where: { invoiceId: invoice.id }, data: { status: "INVOICED" } });
}

/**
 * Issues the invoice to Apple for a READY report: one line per project, with the euro amounts the
 * admin confirmed. The invoice belongs to the Apple account and is issued from its company. A report
 * keeps the invoice even when it fails, so it can be retried; deleting it frees the report.
 */
export async function issueAppStoreInvoice(
  account: AppleAccountWithCompany,
  reportId: string,
  input: Omit<AppStoreInvoiceInput, "period">,
): Promise<Invoice> {
  const report = await prisma.appStoreReport.findUnique({ where: { id: reportId } });
  if (!report || report.accountId !== account.id) throw new ApiError(404, "not_found", "Report not found");
  if (report.status !== "READY" || report.invoiceId !== null) {
    throw new ApiError(409, "conflict", "This report already has an invoice");
  }
  const issuer = appleIssuer(account);
  assertIssuerReady(issuer);

  const payload: AppStoreRequestPayload = { v: 1, kind: "appstore", reportId, period: report.period, ...input };
  const built = applePayload(account, payload);

  // Claim the report first, so two clicks cannot issue two invoices.
  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        appleAccountId: account.id,
        companyId: account.companyId,
        idempotencyKey: `appstore:${account.id}:${report.period}:${Date.now()}`,
        externalRef: `appstore:${report.period}`,
        status: "PENDING",
        customerCategory: "EU_BUSINESS",
        amountCents: totalCents(input.lines),
        stampDutyCents: built.stampDutyCents,
        description: `App Store ${report.period}: ${input.lines.map((l) => l.appName).join(", ")}`,
        dryRun: account.dryRun,
        requestPayload: payload as unknown as Prisma.InputJsonValue,
      },
    });
    const claimed = await tx.appStoreReport.updateMany({
      where: { id: report.id, status: "READY", invoiceId: null },
      data: { invoiceId: created.id },
    });
    if (claimed.count !== 1) throw new ApiError(409, "conflict", "This report already has an invoice");
    return created;
  });

  const issued = await issue(issuer, invoice, () => applePayload(account, payload));
  await markAppStoreReport(issued);
  return issued;
}
