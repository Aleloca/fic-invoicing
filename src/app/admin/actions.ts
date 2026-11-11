"use server";

import { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminSession, destroyAdminSession, requireAdmin } from "@/lib/admin-session";
import { generateApiKey } from "@/lib/api-key";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/errors";
import { buildAuthorizeUrl, listUserCompanies } from "@/lib/fic/client";
import { getFicAccess } from "@/lib/fic/tokens";
import { CUSTOMER_CATEGORIES, FISCAL_REGIMES, STAMP_DUTY_MODES } from "@/lib/fiscal/types";
import { ensureCompany } from "@/lib/projects/accounts";
import { OVERRIDABLE, PROJECT_INCLUDE, type OverridableKey } from "@/lib/projects/config";
import { deleteInvoice, retryInvoice } from "@/lib/invoices/service";
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
function invoicesReturnPath(projectId: string, formData: FormData | undefined, notice: string): string {
  const raw = String(formData?.get("returnTo") ?? "");
  const base = /^\/admin\/(invoices|projects\/[\w-]+\/invoices)(\?[\w=&%.:-]*)?$/.test(raw)
    ? raw
    : `/admin/projects/${projectId}/invoices`;
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
