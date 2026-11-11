/**
 * App Store Connect API: financial reports only. Authenticates with a team API key (Finance
 * access) through a short-lived ES256 JWT.
 */
import { createPrivateKey, sign } from "node:crypto";
import { gunzipSync } from "node:zlib";

const BASE_URL = "https://api.appstoreconnect.apple.com";
const TIMEOUT_MS = 30_000;

export interface AppStoreCredentials {
  issuerId: string;
  keyId: string;
  /** The .p8 file content (PEM). */
  privateKey: string;
  vendorNumber: string;
}

export class AppStoreError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppStoreError";
  }
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** Signed token for the API, valid for 15 minutes (Apple accepts at most 20). */
export function appStoreToken(credentials: AppStoreCredentials, now: number = Date.now()): string {
  let key;
  try {
    key = createPrivateKey(credentials.privateKey);
  } catch {
    throw new AppStoreError(400, "The private key is not a valid .p8 file");
  }
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: credentials.keyId, typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: credentials.issuerId, iat, exp: iat + 15 * 60, aud: "appstoreconnect-v1" }));
  const signature = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64url(signature)}`;
}

function describe(status: number, text: string): string {
  try {
    const first = (JSON.parse(text) as { errors?: Array<{ title?: string; detail?: string }> }).errors?.[0];
    if (first) return `App Store Connect: ${[first.title, first.detail].filter(Boolean).join(" – ")} (HTTP ${status})`;
  } catch {
    // not JSON
  }
  return `App Store Connect returned HTTP ${status}`;
}

/**
 * The FINANCIAL report (all regions, `ZZ`) of a fiscal period, as TSV text.
 * Null when Apple has no report for it: not published yet, or no sales in that period.
 */
export async function downloadFinancialReport(credentials: AppStoreCredentials, period: string): Promise<string | null> {
  const url = new URL("/v1/financeReports", BASE_URL);
  url.searchParams.set("filter[reportType]", "FINANCIAL");
  url.searchParams.set("filter[regionCode]", "ZZ");
  url.searchParams.set("filter[reportDate]", period);
  url.searchParams.set("filter[vendorNumber]", credentials.vendorNumber);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${appStoreToken(credentials)}`, Accept: "application/a-gzip" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const body = Buffer.from(await response.arrayBuffer());
  if (response.status === 404) return null;
  if (!response.ok) throw new AppStoreError(response.status, describe(response.status, body.toString("utf8")));
  try {
    return gunzipSync(body).toString("utf8");
  } catch {
    return body.toString("utf8");
  }
}

export interface AppleAppInfo {
  appleId: string;
  sku: string;
  name: string;
}

async function getJson<T>(credentials: AppStoreCredentials, url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${appStoreToken(credentials)}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new AppStoreError(response.status, describe(response.status, text));
  return JSON.parse(text) as T;
}

/** Every app of the account. Works with a Finance key. */
export async function listApps(credentials: AppStoreCredentials): Promise<AppleAppInfo[]> {
  const apps: AppleAppInfo[] = [];
  let next: string | undefined = `${BASE_URL}/v1/apps?limit=200&fields[apps]=name,sku`;
  while (next) {
    const page: {
      data: Array<{ id: string; attributes?: { name?: string; sku?: string } }>;
      links?: { next?: string };
    } = await getJson(credentials, next);
    for (const app of page.data) apps.push({ appleId: app.id, sku: app.attributes?.sku ?? "", name: app.attributes?.name ?? app.id });
    next = page.links?.next;
  }
  return apps;
}

/**
 * The monthly Sales and Trends summary of a calendar month (YYYY-MM), as TSV; null when there is
 * none. Its "Parent Identifier" column names the app (by SKU) an in-app purchase belongs to.
 */
export async function downloadMonthlySalesReport(credentials: AppStoreCredentials, month: string): Promise<string | null> {
  const url = new URL("/v1/salesReports", BASE_URL);
  url.searchParams.set("filter[reportType]", "SALES");
  url.searchParams.set("filter[reportSubType]", "SUMMARY");
  url.searchParams.set("filter[frequency]", "MONTHLY");
  url.searchParams.set("filter[reportDate]", month);
  url.searchParams.set("filter[vendorNumber]", credentials.vendorNumber);
  url.searchParams.set("filter[version]", "1_0");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${appStoreToken(credentials)}`, Accept: "application/a-gzip" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const body = Buffer.from(await response.arrayBuffer());
  if (response.status === 404) return null;
  if (!response.ok) throw new AppStoreError(response.status, describe(response.status, body.toString("utf8")));
  try {
    return gunzipSync(body).toString("utf8");
  } catch {
    return body.toString("utf8");
  }
}

/** Apple Identifier → Parent Identifier (app SKU) of the in-app purchases in a sales report. */
export function parentsFromSalesReport(tsv: string): Map<string, string> {
  const [head, ...rows] = tsv.split(/\r?\n/);
  const columns = (head ?? "").split("\t").map((c) => c.trim().toLowerCase());
  const id = columns.indexOf("apple identifier");
  const parent = columns.indexOf("parent identifier");
  const parents = new Map<string, string>();
  if (id < 0 || parent < 0) return parents;
  for (const row of rows) {
    const cells = row.split("\t").map((c) => c.trim());
    if (cells[id] && cells[parent]) parents.set(cells[id], cells[parent]);
  }
  return parents;
}
