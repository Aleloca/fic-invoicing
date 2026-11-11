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
import { deleteInvoice, retryInvoice } from "@/lib/invoices/service";
import { createOAuthState } from "@/lib/oauth-state";
import { prisma } from "@/lib/prisma";
import { RateLimiter } from "@/lib/rate-limit";
import { slugify } from "@/lib/slug";

export interface FormState {
  error?: string;
  apiKey?: string;
  tenantId?: string;
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

export async function createTenantAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const slug = slugify(String(formData.get("slug") ?? "") || name);
  if (!name || name.length > 100) return { error: "Name is required (max 100 characters)." };
  if (!slug) return { error: "Slug must contain letters or digits." };

  const key = generateApiKey();
  try {
    const tenant = await prisma.tenant.create({
      data: { name, slug, apiKeyHash: key.hash, apiKeyPrefix: key.displayPrefix },
    });
    revalidatePath("/admin");
    return { apiKey: key.plaintext, tenantId: tenant.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: `Slug "${slug}" is already in use.` };
    }
    throw error;
  }
}

export async function rotateApiKeyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const tenantId = String(formData.get("tenantId") ?? "");
  const exists = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!exists) return { error: "Unknown tenant." };
  const key = generateApiKey();
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { apiKeyHash: key.hash, apiKeyPrefix: key.displayPrefix },
  });
  revalidatePath(`/admin/tenants/${tenantId}`);
  return { apiKey: key.plaintext, tenantId };
}

export async function startFicConnectAction(tenantId: string): Promise<void> {
  await requireAdmin();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) redirect("/admin");
  redirect(buildAuthorizeUrl(createOAuthState(tenant.id)));
}

export async function disconnectFicAction(tenantId: string): Promise<void> {
  await requireAdmin();
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      accessTokenEnc: null,
      refreshTokenEnc: null,
      tokenExpiresAt: null,
      connectedAt: null,
      ficCompanyId: null,
      ficCompanyName: null,
      ficNeedsReconnect: false,
      ficLastError: null,
    },
  });
  redirect(`/admin/tenants/${tenantId}?notice=disconnected`);
}

export async function selectCompanyAction(tenantId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const companyId = Number(formData.get("companyId"));
  const access = await getFicAccess(tenantId);
  const company = (await listUserCompanies(access.accessToken)).find((c) => c.id === companyId);
  if (!company) redirect(`/admin/tenants/${tenantId}/company?error=unknown_company`);
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { ficCompanyId: company.id, ficCompanyName: company.name, connectedAt: new Date() },
  });
  redirect(`/admin/tenants/${tenantId}?notice=connected`);
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

const configSchema = z.object({
  name: z.string().trim().min(1).max(100),
  vatTypeId: optionalId,
  nonTaxableVatTypeId: optionalId,
  paymentAccountId: optionalId,
  paymentMethodId: optionalId,
  numeration: optionalText(20),
  itemCode: optionalText(50),
  fiscalRegime: z.enum(FISCAL_REGIMES),
  stampDutyMode: z.enum(STAMP_DUTY_MODES),
  stampDutyVatTypeId: optionalId,
  eiPaymentMethod: z
    .string()
    .trim()
    .regex(/^MP\d{2}$/, "Must be an SDI payment code like MP08"),
});

export async function updateTenantConfigAction(tenantId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const field = (name: string) => String(formData.get(name) ?? "");
  const parsed = configSchema.safeParse({
    name: field("name"),
    vatTypeId: field("vatTypeId"),
    nonTaxableVatTypeId: field("nonTaxableVatTypeId"),
    paymentAccountId: field("paymentAccountId"),
    paymentMethodId: field("paymentMethodId"),
    numeration: field("numeration"),
    itemCode: field("itemCode"),
    fiscalRegime: field("fiscalRegime"),
    stampDutyMode: field("stampDutyMode"),
    stampDutyVatTypeId: field("stampDutyVatTypeId"),
    eiPaymentMethod: field("eiPaymentMethod"),
  });
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    redirect(`/admin/tenants/${tenantId}?error=${encodeURIComponent(message)}`);
  }

  const statements: Record<string, string> = {};
  for (const category of CUSTOMER_CATEGORIES) {
    const value = field(`statement_${category}`).trim();
    if (value) statements[category] = value.slice(0, 2000);
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      ...parsed.data,
      fiscalStatements: Object.keys(statements).length > 0 ? statements : Prisma.DbNull,
      sendToSdi: formData.get("sendToSdi") === "on",
      dryRun: formData.get("dryRun") === "on",
      active: formData.get("active") === "on",
    },
  });
  redirect(`/admin/tenants/${tenantId}?notice=saved`);
}

/** Where an invoice action returns: the page it was sent from, when it is an admin invoices list. */
function invoicesReturnPath(tenantId: string, formData: FormData | undefined, notice: string): string {
  const raw = String(formData?.get("returnTo") ?? "");
  const base = /^\/admin\/(invoices|tenants\/[\w-]+\/invoices)(\?[\w=&%.:-]*)?$/.test(raw)
    ? raw
    : `/admin/tenants/${tenantId}/invoices`;
  const url = new URL(base, "http://local");
  url.searchParams.set("notice", notice);
  return `${url.pathname}${url.search}`;
}

export async function retryInvoiceAction(tenantId: string, invoiceId: string, formData?: FormData): Promise<void> {
  await requireAdmin();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  let notice = "retried";
  try {
    const invoice = await retryInvoice(tenant, invoiceId);
    if (invoice.status === "FAILED") notice = "retry_failed";
  } catch (error) {
    notice = error instanceof ApiError ? `retry_error:${error.code}` : "retry_error";
  }
  redirect(invoicesReturnPath(tenantId, formData, notice));
}

export async function deleteInvoiceAction(tenantId: string, invoiceId: string, formData?: FormData): Promise<void> {
  await requireAdmin();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  let notice = "deleted";
  try {
    await deleteInvoice(tenant, invoiceId);
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("[fic-invoicing] unexpected error while deleting invoice", invoiceId, error);
    notice = error instanceof ApiError ? `delete_error:${error.code}:${error.message}` : "delete_error";
  }
  redirect(invoicesReturnPath(tenantId, formData, notice));
}
