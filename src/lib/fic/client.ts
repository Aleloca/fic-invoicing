/**
 * Thin HTTP client for the Fatture in Cloud API v2.
 * All functions take explicit credentials; token storage lives in ./tokens.ts.
 */
import { env, ficRedirectUri } from "../env";
import type { FicIssuedDocumentRequest } from "../fiscal/payload";

/** OAuth scopes requested when connecting a company. */
export const FIC_SCOPES = [
  "issued_documents.invoices:r",
  "issued_documents.invoices:a",
  "entity.clients:r",
  "entity.suppliers:r",
  "settings:r",
] as const;

const TIMEOUT_MS = 20_000;

export class FicHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "FicHttpError";
  }
}

export interface FicTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
}

export interface FicCompany {
  id: number;
  name: string;
}

export interface FicVatType {
  id: number;
  value: number;
  description: string;
  notes?: string;
  ei_type?: string;
  ei_description?: string;
  is_disabled?: boolean;
}

export interface FicPaymentAccount {
  id: number;
  name: string;
  type?: string;
}

export interface FicPaymentMethod {
  id: number;
  name: string;
  type?: string;
  is_default?: boolean;
}

export interface FicCreatedDocument {
  id: number | null;
  number: number | null;
  numeration: string | null;
  amountDue: number | null;
}

/** Extracts a human-readable message from a FIC error body, keeping it short. */
function describeError(status: number, text: string): string {
  let detail = text;
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string; validation_result?: unknown } | string;
      error_description?: string;
      message?: string;
    };
    if (typeof parsed.error === "object" && parsed.error) {
      detail = [parsed.error.message, parsed.error.validation_result ? JSON.stringify(parsed.error.validation_result) : ""]
        .filter(Boolean)
        .join(" ");
    } else {
      detail =
        [typeof parsed.error === "string" ? parsed.error : "", parsed.error_description ?? parsed.message ?? ""]
          .filter(Boolean)
          .join(": ") || text;
    }
  } catch {
    // not JSON
  }
  return `FIC HTTP ${status}: ${detail}`.slice(0, 1000);
}

async function ficRequest<T>(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.token) headers.Authorization = `Bearer ${init.token}`;

  const response = await fetch(`${env.ficApiBaseUrl()}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new FicHttpError(response.status, describeError(response.status, text), text);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.ficClientId(),
    redirect_uri: ficRedirectUri(),
    scope: FIC_SCOPES.join(" "),
    state,
  });
  return `${env.ficApiBaseUrl()}/oauth/authorize?${params.toString()}`;
}

export function exchangeCodeForTokens(code: string): Promise<FicTokenResponse> {
  return ficRequest<FicTokenResponse>("/oauth/token", {
    method: "POST",
    body: {
      grant_type: "authorization_code",
      client_id: env.ficClientId(),
      client_secret: env.ficClientSecret(),
      redirect_uri: ficRedirectUri(),
      code,
    },
  });
}

/** Exchanges a refresh token. FIC rotates refresh tokens: the old one stops working. */
export function refreshTokens(refreshToken: string): Promise<FicTokenResponse> {
  return ficRequest<FicTokenResponse>("/oauth/token", {
    method: "POST",
    body: {
      grant_type: "refresh_token",
      client_id: env.ficClientId(),
      client_secret: env.ficClientSecret(),
      refresh_token: refreshToken,
    },
  });
}

export interface FicUserInfo {
  id: number;
  name: string;
  email: string | null;
}

/** The FIC user who granted the authorization. */
export async function getUserInfo(token: string): Promise<FicUserInfo> {
  const result = await ficRequest<{ data?: { id?: number; name?: string; email?: string } }>("/user/info", { token });
  const data = result.data ?? {};
  if (typeof data.id !== "number") throw new FicHttpError(502, "Fatture in Cloud returned no user id", JSON.stringify(result));
  return { id: data.id, name: data.name?.trim() || data.email || `User #${data.id}`, email: data.email ?? null };
}

export async function listUserCompanies(token: string): Promise<FicCompany[]> {
  const result = await ficRequest<{ data?: { companies?: Array<{ id: number; name: string }> } }>(
    "/user/companies",
    { token },
  );
  return (result.data?.companies ?? []).map((c) => ({ id: c.id, name: c.name }));
}

export async function listVatTypes(token: string, companyId: number): Promise<FicVatType[]> {
  const result = await ficRequest<{ data?: FicVatType[] }>(`/c/${companyId}/info/vat_types`, { token });
  return result.data ?? [];
}

export async function listPaymentAccounts(token: string, companyId: number): Promise<FicPaymentAccount[]> {
  const result = await ficRequest<{ data?: FicPaymentAccount[] }>(`/c/${companyId}/info/payment_accounts`, { token });
  return result.data ?? [];
}

export async function listPaymentMethods(token: string, companyId: number): Promise<FicPaymentMethod[]> {
  const result = await ficRequest<{ data?: FicPaymentMethod[] }>(`/c/${companyId}/info/payment_methods`, { token });
  return result.data ?? [];
}

export async function createIssuedDocument(
  token: string,
  companyId: number,
  body: FicIssuedDocumentRequest,
): Promise<FicCreatedDocument> {
  const result = await ficRequest<{
    data?: { id?: number | null; number?: number | null; numeration?: string | null; amount_due?: number | null };
  }>(`/c/${companyId}/issued_documents`, { method: "POST", token, body });
  return {
    id: result.data?.id ?? null,
    number: result.data?.number ?? null,
    numeration: result.data?.numeration ?? null,
    amountDue: result.data?.amount_due ?? null,
  };
}

export interface FicDocumentMatch {
  id: number;
  number: number | null;
  numeration: string | null;
}

/**
 * Looks for an issued document by its internal subject among the most recent ones (`pages` × 100).
 * Throws when the response does not include the subject: then nothing can be concluded.
 */
export async function findIssuedDocumentBySubject(
  token: string,
  companyId: number,
  subject: string,
  pages = 3,
): Promise<FicDocumentMatch | null> {
  for (let page = 1; page <= pages; page += 1) {
    const params = new URLSearchParams({
      type: "invoice",
      fields: "id,number,numeration,subject",
      sort: "-id",
      per_page: "100",
      page: String(page),
    });
    const result = await ficRequest<{
      data?: Array<{ id?: number; number?: number | null; numeration?: string | null; subject?: string | null }>;
      last_page?: number;
    }>(`/c/${companyId}/issued_documents?${params.toString()}`, { token });
    const docs = result.data ?? [];
    if (docs.length > 0 && !docs.every((d) => "subject" in d)) {
      throw new Error("Fatture in Cloud did not return the document subjects: check the invoice by hand");
    }
    const match = docs.find((d) => d.subject === subject && typeof d.id === "number");
    if (match) return { id: match.id!, number: match.number ?? null, numeration: match.numeration ?? null };
    if (docs.length < 100 || (result.last_page !== undefined && page >= result.last_page)) break;
  }
  return null;
}

export interface FicDocumentTotals {
  amountNet: number | null;
  amountGross: number | null;
  amountDue: number | null;
  stampDuty: number | null;
  paymentsSum: number | null;
}

const numberOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/**
 * Computes the totals of a document without creating it (`POST .../issued_documents/totals`).
 * FIC has no dry run on creation: this is the only way to validate without consuming a number.
 */
export async function computeIssuedDocumentTotals(
  token: string,
  companyId: number,
  body: FicIssuedDocumentRequest,
): Promise<FicDocumentTotals> {
  const result = await ficRequest<{ data?: Record<string, unknown> }>(`/c/${companyId}/issued_documents/totals`, {
    method: "POST",
    token,
    body: { data: body.data },
  });
  const data = result.data ?? {};
  return {
    amountNet: numberOrNull(data.amount_net),
    amountGross: numberOrNull(data.amount_gross),
    amountDue: numberOrNull(data.amount_due),
    stampDuty: numberOrNull(data.stamp_duty),
    paymentsSum: numberOrNull(data.payments_sum),
  };
}

/**
 * Deletes an issued document. Returns false when FIC answers 404 (already deleted).
 * FIC refuses to delete e-invoices already sent to SDI.
 */
export async function deleteIssuedDocument(token: string, companyId: number, documentId: number): Promise<boolean> {
  try {
    await ficRequest(`/c/${companyId}/issued_documents/${documentId}`, { method: "DELETE", token });
    return true;
  } catch (error) {
    if (error instanceof FicHttpError && error.status === 404) return false;
    throw error;
  }
}

/** Asks FIC to transmit an existing e-invoice to SDI. */
export async function sendEInvoice(token: string, companyId: number, documentId: number): Promise<void> {
  await ficRequest(`/c/${companyId}/issued_documents/${documentId}/e_invoice/send`, {
    method: "POST",
    token,
    body: {},
  });
}

/**
 * Resolves the courtesy-copy PDF URL of a document and fetches it.
 * Returns the upstream response so the caller can stream the body.
 */
export async function fetchCourtesyPdf(token: string, companyId: number, documentId: number): Promise<Response> {
  const preview = await ficRequest<{ data?: { url?: string } }>(
    `/c/${companyId}/issued_documents/${documentId}/preview_url?type=courtesy_invoice&download=1&format=pdf`,
    { token },
  );
  const url = preview.data?.url;
  if (!url) {
    throw new FicHttpError(404, "PDF not available yet for this document");
  }
  const pdf = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!pdf.ok || !pdf.body) {
    throw new FicHttpError(pdf.status, `Failed to download PDF: HTTP ${pdf.status}`);
  }
  return pdf;
}
