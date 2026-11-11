/**
 * Environment access. Values are read lazily so that `next build` works
 * without secrets; each getter throws a clear error when a required value
 * is missing at runtime.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function int(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const env = {
  encryptionKey: () => required("ENCRYPTION_KEY"),
  sessionSecret: () => {
    const secret = required("SESSION_SECRET");
    if (secret.length < 32) {
      throw new Error("SESSION_SECRET must be at least 32 characters long");
    }
    return secret;
  },
  adminPassword: () => required("ADMIN_PASSWORD"),
  ficClientId: () => required("FIC_CLIENT_ID"),
  ficClientSecret: () => required("FIC_CLIENT_SECRET"),
  publicBaseUrl: () => required("PUBLIC_BASE_URL").replace(/\/+$/, ""),
  ficApiBaseUrl: () =>
    (process.env.FIC_API_BASE_URL || "https://api-v2.fattureincloud.it").replace(/\/+$/, ""),
  purgePayloadOnSuccess: () => bool("PURGE_PAYLOAD_ON_SUCCESS", true),
  rateLimitPerMinute: () => int("RATE_LIMIT_PER_MINUTE", 60),
};

/** OAuth redirect URI registered in the FIC developer console. */
export function ficRedirectUri(): string {
  return `${env.publicBaseUrl()}/api/oauth/fic/callback`;
}
