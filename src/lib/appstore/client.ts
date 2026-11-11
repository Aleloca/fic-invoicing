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
