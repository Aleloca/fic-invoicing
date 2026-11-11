"use server";

import { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminSession, destroyAdminSession, requireAdmin } from "@/lib/admin-session";
import { generateApiKey } from "@/lib/api-key";
import { checkAccount, discoverProducts, suggestStartPeriod } from "@/lib/appstore/check";
import { decrypt, encrypt, safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import { buildAuthorizeUrl, listUserCompanies } from "@/lib/fic/client";
import { getFicAccess } from "@/lib/fic/tokens";
import { CUSTOMER_CATEGORIES, FISCAL_REGIMES, STAMP_DUTY_MODES } from "@/lib/fiscal/types";
import { ensureCompany } from "@/lib/projects/accounts";
import { OVERRIDABLE, PROJECT_INCLUDE, type OverridableKey } from "@/lib/projects/config";
import {
  APPLE_ACCOUNT_INCLUDE,
  deleteAppleInvoice,
  deleteInvoice,
  issueAppStoreInvoice,
  retryAppleInvoice,
  retryInvoice,
} from "@/lib/invoices/service";
import { groupReport } from "@/lib/appstore/groups";
import type { ReportLine } from "@/lib/appstore/report";
import { createOAuthState } from "@/lib/oauth-state";
import { prisma } from "@/lib/prisma";
import { RateLimiter } from "@/lib/rate-limit";
import { slugify } from "@/lib/slug";

export interface FormState {
  error?: string;
  apiKey?: string;
  projectId?: string;
}

const loginLimiter = new RateLimiter(10);

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (loginLimiter.hit(`login:${ip}`) > 0) return { error: "Too many attempts, try again in a minute." };
  const password = String(formData.get("password") ?? "");
  if (!password || !safeEqual(password, env.adminPassword())) return { error: "Wrong password." };
  await createAdminSession();
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  await destroyAdminSession();
  redirect("/admin/login");
}

export async function createProjectAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const slug = slugify(String(formData.get("slug") ?? "") || name);
  if (!name || name.length > 100) return { error: "Name is required (max 100 characters)." };
  if (!slug) return { error: "Slug must contain letters or digits." };
  const companyId = String(formData.get("companyId") ?? "") || null;
  if (companyId && !(await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } }))) {
    return { error: "Unknown company." };
  }

  const key = generateApiKey();
  try {
    const project = await prisma.project.create({
      data: { name, slug, apiKeyHash: key.hash, apiKeyPrefix: key.displayPrefix, companyId },
    });
    revalidatePath("/admin");
    return { apiKey: key.plaintext, projectId: project.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: `Slug "${slug}" is already in use.` };
    }
    throw error;
  }
}

export async function rotateApiKeyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const projectId = String(formData.get("projectId") ?? "");
  const exists = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!exists) return { error: "Unknown project." };
  const key = generateApiKey();
  await prisma.project.update({
    where: { id: projectId },
    data: { apiKeyHash: key.hash, apiKeyPrefix: key.displayPrefix },
  });
  revalidatePath(`/admin/projects/${projectId}`);
  return { apiKey: key.plaintext, projectId };
}

/** Starts the FIC authorization for a new account, optionally returning to a project. */
export async function connectAccountAction(projectId: string | null): Promise<void> {
  await requireAdmin();
  redirect(buildAuthorizeUrl(createOAuthState(projectId ? { projectId } : {})));
}

/** Starts the FIC authorization again for an existing account (expired or revoked tokens). */
export async function reconnectAccountAction(accountId: string, projectId: string | null): Promise<void> {
  await requireAdmin();
  const account = await prisma.ficAccount.findUnique({ where: { id: accountId }, select: { id: true } });
  if (!account) redirect("/admin/fic?error=oauth_unknown_account");
  redirect(buildAuthorizeUrl(createOAuthState(projectId ? { accountId, projectId } : { accountId })));
}

export async function disconnectAccountAction(accountId: string): Promise<void> {
  await requireAdmin();
  await prisma.ficAccount.update({
    where: { id: accountId },
    data: { accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, needsReconnect: false, lastError: null },
  });
  redirect(`/admin/fic?notice=disconnected`);
}

/** Removes an account and its companies, when no project uses them and no invoice was issued from them. */
export async function removeAccountAction(accountId: string): Promise<void> {
  await requireAdmin();
  const inUse = await prisma.company.count({
    where: { accountId, OR: [{ projects: { some: {} } }, { invoices: { some: {} } }] },
  });
  if (inUse > 0) redirect(`/admin/fic?error=account_in_use`);
  await prisma.$transaction([
    prisma.company.deleteMany({ where: { accountId } }),
    prisma.ficAccount.delete({ where: { id: accountId } }),
  ]);
  redirect(`/admin/fic?notice=account_removed`);
}

export async function renameAccountAction(accountId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const label = String(formData.get("label") ?? "").trim().slice(0, 100);
  if (label) await prisma.ficAccount.update({ where: { id: accountId }, data: { label } });
  redirect(`/admin/fic?notice=saved`);
}

/** Removes a company row that no project uses and no invoice was issued from. */
export async function removeCompanyAction(companyId: string): Promise<void> {
  await requireAdmin();
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { _count: { select: { projects: true, invoices: true } } },
  });
  if (!company) redirect("/admin/fic");
  if (company._count.projects > 0 || company._count.invoices > 0) redirect(`/admin/companies/${companyId}?error=company_in_use`);
  await prisma.company.delete({ where: { id: companyId } });
  redirect(`/admin/fic?notice=company_removed`);
}

/** Points a project at a FIC company (`<accountId>:<ficCompanyId>`), creating the company row on first use. */
export async function selectCompanyAction(projectId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const [accountId, rawId] = String(formData.get("company") ?? "").split(":");
  const ficCompanyId = Number(rawId);
  const back = `/admin/projects/${projectId}/company`;
  if (!accountId || !Number.isInteger(ficCompanyId)) redirect(`${back}?error=unknown_company`);

  let token: string;
  try {
    token = await getFicAccess(accountId);
  } catch (error) {
    redirect(`${back}?error=${encodeURIComponent(error instanceof Error ? error.message : "unknown_company")}`);
  }
  const ficCompany = (await listUserCompanies(token)).find((c) => c.id === ficCompanyId);
  if (!ficCompany) redirect(`${back}?error=unknown_company`);
  const company = await ensureCompany(accountId, ficCompany);
  await prisma.project.update({ where: { id: projectId }, data: { companyId: company.id } });
  redirect(`/admin/projects/${projectId}?notice=connected`);
}

const optionalId = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : Number(v)))
  .refine((v) => v === null || (Number.isInteger(v) && v > 0), "Must be a positive integer");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const eiPaymentMethod = z
  .string()
  .trim()
  .regex(/^MP\d{2}$/, "Must be an SDI payment code like MP08");

const companySchema = z.object({
  fiscalRegime: z.enum(FISCAL_REGIMES),
  vatTypeId: optionalId,
  nonTaxableVatTypeId: optionalId,
  paymentAccountId: optionalId,
  paymentMethodId: optionalId,
  numeration: optionalText(20),
  itemCode: optionalText(50),
  eiPaymentMethod,
  stampDutyMode: z.enum(STAMP_DUTY_MODES),
  stampDutyVatTypeId: optionalId,
});

/** Per-category statement texts from the form; empty fields are left out (inherit / preset). */
function statementsFrom(formData: FormData) {
  const statements: Record<string, string> = {};
  for (const category of CUSTOMER_CATEGORIES) {
    const value = String(formData.get(`statement_${category}`) ?? "").trim();
    if (value) statements[category] = value.slice(0, 2000);
  }
  return Object.keys(statements).length > 0 ? statements : Prisma.DbNull;
}

function issuesMessage(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
}

export async function updateCompanyAction(companyId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const field = (name: string) => String(formData.get(name) ?? "");
  const parsed = companySchema.safeParse(Object.fromEntries(Object.keys(companySchema.shape).map((k) => [k, field(k)])));
  if (!parsed.success) redirect(`/admin/companies/${companyId}?error=${encodeURIComponent(issuesMessage(parsed.error))}`);

  await prisma.company.update({
    where: { id: companyId },
    data: { ...parsed.data, fiscalStatements: statementsFrom(formData), sendToSdi: formData.get("sendToSdi") === "on" },
  });
  redirect(`/admin/companies/${companyId}?notice=saved`);
}

/** Overrides keep "" for an explicitly empty text, so it does not fall back to the company value. */
const overrideText = (max: number) => z.string().trim().max(max);

const overrideSchemas = {
  vatTypeId: optionalId,
  nonTaxableVatTypeId: optionalId,
  paymentAccountId: optionalId,
  paymentMethodId: optionalId,
  numeration: overrideText(20),
  itemCode: overrideText(50),
  eiPaymentMethod,
  stampDutyMode: z.enum(STAMP_DUTY_MODES),
  stampDutyVatTypeId: optionalId,
  sendToSdi: z.string().transform((v) => v === "on"),
} satisfies Record<OverridableKey, z.ZodType>;

export async function updateProjectAction(projectId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const back = `/admin/projects/${projectId}`;
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 100) redirect(`${back}?error=${encodeURIComponent("name: required, max 100 characters")}`);

  // Each setting is either inherited (null) or customized, when its "custom" box is ticked.
  const overrides: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const key of OVERRIDABLE) {
    if (formData.get(`custom_${key}`) !== "on") {
      overrides[key] = null;
      continue;
    }
    const parsed = overrideSchemas[key].safeParse(String(formData.get(key) ?? ""));
    if (parsed.success) overrides[key] = parsed.data;
    else problems.push(`${key}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  if (problems.length > 0) redirect(`${back}?error=${encodeURIComponent(problems.join("; "))}`);

  await prisma.project.update({
    where: { id: projectId },
    data: {
      name,
      ...overrides,
      fiscalStatements: statementsFrom(formData),
      dryRun: formData.get("dryRun") === "on",
      active: formData.get("active") === "on",
    },
  });
  redirect(`${back}?notice=saved`);
}

/** Where an invoice action returns: the page it was sent from, when it is an admin invoices list. */
function invoicesReturnPath(projectId: string | null, formData: FormData | undefined, notice: string): string {
  const raw = String(formData?.get("returnTo") ?? "");
  const base = /^\/admin\/(invoices|projects\/[\w-]+\/invoices|apple\/[\w-]+)(\?[\w=&%.:-]*)?$/.test(raw)
    ? raw
    : projectId
      ? `/admin/projects/${projectId}/invoices`
      : "/admin/invoices";
  const url = new URL(base, "http://local");
  url.searchParams.set("notice", notice);
  return `${url.pathname}${url.search}`;
}

export async function retryInvoiceAction(projectId: string, invoiceId: string, formData?: FormData): Promise<void> {
  await requireAdmin();
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: PROJECT_INCLUDE });
  let notice = "retried";
  try {
    const invoice = await retryInvoice(project, invoiceId);
    if (invoice.status === "FAILED") notice = "retry_failed";
  } catch (error) {
    notice = error instanceof ApiError ? `retry_error:${error.code}` : "retry_error";
  }
  redirect(invoicesReturnPath(projectId, formData, notice));
}

export async function deleteInvoiceAction(projectId: string, invoiceId: string, formData?: FormData): Promise<void> {
  await requireAdmin();
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: PROJECT_INCLUDE });
  let notice = "deleted";
  try {
    await deleteInvoice(project, invoiceId);
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("[fic-invoicing] unexpected error while deleting invoice", invoiceId, error);
    notice = error instanceof ApiError ? `delete_error:${error.code}:${error.message}` : "delete_error";
  }
  redirect(invoicesReturnPath(projectId, formData, notice));
}

// ------------------------------------------------------------------ Apple accounts (App Store payouts)

const applePath = (accountId: string) => `/admin/apple/${accountId}`;

function appleBack(accountId: string, key: "notice" | "error", value: string): never {
  redirect(`${applePath(accountId)}?${key}=${encodeURIComponent(value)}`);
}

const appleSchema = z.object({
  label: z.string().trim().min(1, "required").max(100),
  issuerId: z.string().trim().min(1, "required").max(100),
  keyId: z.string().trim().min(1, "required").max(40),
  vendorNumber: z.string().trim().regex(/^\d+$/, "digits only"),
  companyId: z.string().trim(),
  itemName: z.string().trim().min(1, "required").max(200),
  vatTypeId: optionalId,
  paymentAccountId: optionalId,
  paymentMethodId: optionalId,
  eiPaymentMethod,
  statement: optionalText(2000),
  customerName: z.string().trim().min(1, "required").max(200),
  customerVatNumber: z.string().trim().min(2, "required").max(30),
  customerAddress: z.string().trim().max(200),
  customerZipCode: z.string().trim().max(20),
  customerCity: z.string().trim().max(100),
  customerProvince: z.string().trim().max(100),
  customerCountryCode: z.string().trim().regex(/^[A-Za-z]{2}$/, "two-letter country code"),
  startPeriod: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2})?$/, "invalid period"),
});

/**
 * Creates (accountId null) or updates an Apple account. New or changed credentials are tested
 * against Apple; a new account starts after the latest report Apple has, unless a period is chosen.
 */
export async function saveAppleAccountAction(accountId: string | null, formData: FormData): Promise<void> {
  await requireAdmin();
  const errorBack: (message: string) => never = (message) =>
    accountId ? appleBack(accountId, "error", message) : redirect(`/admin/apple/new?error=${encodeURIComponent(message)}`);
  const field = (name: string) => String(formData.get(name) ?? "");
  const parsed = appleSchema.safeParse(Object.fromEntries(Object.keys(appleSchema.shape).map((k) => [k, field(k)])));
  if (!parsed.success) errorBack(issuesMessage(parsed.error));
  const d = parsed.data;
  if (d.companyId && !(await prisma.company.findUnique({ where: { id: d.companyId }, select: { id: true } }))) {
    errorBack("Unknown company.");
  }

  const file = formData.get("privateKey");
  const uploaded = file instanceof File && file.size > 0 ? (await file.text()).trim() : "";
  if (uploaded && !uploaded.includes("PRIVATE KEY")) errorBack("The private key must be the .p8 file from App Store Connect.");

  const existing = accountId ? await prisma.appleAccount.findUnique({ where: { id: accountId } }) : null;
  if (accountId && !existing) redirect("/admin/apple");
  if (!existing && !uploaded) errorBack("Upload the .p8 private key.");
  const privateKey = uploaded || decrypt(existing!.privateKeyEnc);
  const credentialsChanged =
    !existing ||
    Boolean(uploaded) ||
    existing.issuerId !== d.issuerId ||
    existing.keyId !== d.keyId ||
    existing.vendorNumber !== d.vendorNumber;

  let nextPeriod = d.startPeriod || existing?.nextPeriod || "";
  if (credentialsChanged) {
    try {
      const suggested = await suggestStartPeriod({ issuerId: d.issuerId, keyId: d.keyId, privateKey, vendorNumber: d.vendorNumber });
      if (!nextPeriod) nextPeriod = suggested.start;
    } catch (error) {
      errorBack(`App Store Connect refused the key: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  const data = {
    label: d.label,
    issuerId: d.issuerId,
    keyId: d.keyId,
    vendorNumber: d.vendorNumber,
    privateKeyEnc: encrypt(privateKey),
    companyId: d.companyId || null,
    dryRun: formData.get("dryRun") === "on",
    itemName: d.itemName,
    vatTypeId: d.vatTypeId,
    paymentAccountId: d.paymentAccountId,
    paymentMethodId: d.paymentMethodId,
    eiPaymentMethod: d.eiPaymentMethod,
    statement: d.statement,
    customer: {
      name: d.customerName,
      vatNumber: d.customerVatNumber,
      address: d.customerAddress,
      zipCode: d.customerZipCode,
      city: d.customerCity,
      province: d.customerProvince,
      countryCode: d.customerCountryCode.toUpperCase(),
    },
    nextPeriod,
    lastError: null,
  };
  if (existing) {
    await prisma.appleAccount.update({ where: { id: existing.id }, data });
    appleBack(existing.id, "notice", "apple_saved");
  }
  const created = await prisma.appleAccount.create({ data });
  // Products sold so far, so they can be assigned to projects before the first report.
  await discoverProducts(created.id).catch((error) =>
    console.warn("[fic-invoicing] could not read past Apple reports", error instanceof Error ? error.message : error),
  );
  appleBack(created.id, "notice", "apple_connected");
}

export async function checkAppleAccountAction(accountId: string): Promise<void> {
  await requireAdmin();
  let found: string[] = [];
  try {
    found = (await checkAccount(accountId)).found;
  } catch (error) {
    appleBack(accountId, "error", `Check failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  appleBack(accountId, "notice", found.length > 0 ? "apple_found" : "apple_nothing_new");
}

/** Reads the products of the past reports, so they can be assigned before the next report. */
export async function discoverAppleProductsAction(accountId: string): Promise<void> {
  await requireAdmin();
  let found = 0;
  try {
    found = await discoverProducts(accountId);
  } catch (error) {
    appleBack(accountId, "error", `Could not read the past reports: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  appleBack(accountId, "notice", found > 0 ? "apple_products_found" : "apple_products_none");
}

/** Assigns the account's products to projects: one `product_<id>` field per product (empty = unassigned). */
export async function assignAppleProductsAction(accountId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const products = await prisma.appleProduct.findMany({ where: { accountId }, select: { id: true } });
  const projectIds = new Set((await prisma.project.findMany({ select: { id: true } })).map((p) => p.id));
  for (const product of products) {
    const value = formData.get(`product_${product.id}`);
    if (value === null) continue;
    const projectId = String(value);
    if (projectId && !projectIds.has(projectId)) continue;
    await prisma.appleProduct.update({ where: { id: product.id }, data: { projectId: projectId || null } });
  }
  appleBack(accountId, "notice", "apple_products_saved");
}

/** "1,18", "1.18" or "1 234,50" euro → cents. */
function euroCents(raw: string): number | null {
  const clean = raw.trim().replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** Issues the invoice to Apple for a report: one `amount_<projectId>` field per project of the report. */
export async function issueAppleInvoiceAction(accountId: string, reportId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const account = await prisma.appleAccount.findUnique({ where: { id: accountId }, include: APPLE_ACCOUNT_INCLUDE });
  if (!account) redirect("/admin/apple");
  const report = await prisma.appStoreReport.findFirst({ where: { id: reportId, accountId } });
  if (!report) appleBack(accountId, "error", "Report not found.");
  const products = await prisma.appleProduct.findMany({ where: { accountId }, include: { project: { select: { name: true } } } });
  const groups = groupReport(report.lines as unknown as ReportLine[], products, undefined);
  if (groups.unassigned.length > 0) appleBack(accountId, "error", "Assign every product of the report to a project first.");

  const lines = [];
  for (const group of groups.projects) {
    const amountCents = euroCents(String(formData.get(`amount_${group.projectId}`) ?? ""));
    if (!amountCents || amountCents <= 0) appleBack(accountId, "error", `Type the amount in euro for ${group.projectName}, for example 1,18.`);
    lines.push({ projectId: group.projectId, appName: group.projectName, amountCents });
  }
  const date = String(formData.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) appleBack(accountId, "error", "Pick the invoice date.");
  const transactionId = String(formData.get("transactionId") ?? "").trim().slice(0, 60) || null;

  let notice = "apple_issued";
  try {
    const invoice = await issueAppStoreInvoice(account, reportId, { lines, date, transactionId });
    if (invoice.status === "FAILED") notice = "apple_failed";
  } catch (error) {
    appleBack(accountId, "error", error instanceof Error ? error.message : "Could not issue the invoice");
  }
  appleBack(accountId, "notice", notice);
}

/** Marks a report as invoiced by hand, or (undo) ready again. */
export async function setAppleReportDismissedAction(accountId: string, reportId: string, dismissed: boolean): Promise<void> {
  await requireAdmin();
  await prisma.appStoreReport.updateMany({
    where: { id: reportId, accountId, invoiceId: null },
    data: { status: dismissed ? "DISMISSED" : "READY" },
  });
  appleBack(accountId, "notice", dismissed ? "apple_dismissed" : "apple_restored");
}

/** Removes an Apple account that has no invoices; its reports and products go with it. */
export async function removeAppleAccountAction(accountId: string): Promise<void> {
  await requireAdmin();
  if ((await prisma.invoice.count({ where: { appleAccountId: accountId } })) > 0) {
    appleBack(accountId, "error", "This account has invoices to Apple, kept for the record: it cannot be removed.");
  }
  await prisma.appleAccount.delete({ where: { id: accountId } });
  redirect("/admin/apple?notice=apple_removed");
}

export async function retryAppleInvoiceAction(accountId: string, invoiceId: string, formData?: FormData): Promise<void> {
  await requireAdmin();
  const account = await prisma.appleAccount.findUniqueOrThrow({ where: { id: accountId }, include: APPLE_ACCOUNT_INCLUDE });
  let notice = "retried";
  try {
    const invoice = await retryAppleInvoice(account, invoiceId);
    if (invoice.status === "FAILED") notice = "retry_failed";
  } catch (error) {
    notice = error instanceof ApiError ? `retry_error:${error.code}` : "retry_error";
  }
  redirect(invoicesReturnPath(null, formData, notice));
}

export async function deleteAppleInvoiceAction(accountId: string, invoiceId: string, formData?: FormData): Promise<void> {
  await requireAdmin();
  const account = await prisma.appleAccount.findUniqueOrThrow({ where: { id: accountId }, include: APPLE_ACCOUNT_INCLUDE });
  let notice = "deleted";
  try {
    await deleteAppleInvoice(account, invoiceId);
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("[fic-invoicing] unexpected error while deleting invoice", invoiceId, error);
    notice = error instanceof ApiError ? `delete_error:${error.code}:${error.message}` : "delete_error";
  }
  redirect(invoicesReturnPath(null, formData, notice));
}
