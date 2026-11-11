import { env } from "./env";
import { randomToken, signPayload, verifySigned } from "./crypto";

const PURPOSE = "fic-oauth-state";
const TTL_SECONDS = 15 * 60;

interface StatePayload {
  tid: string;
  n: string;
  exp: number;
  [key: string]: unknown;
}

/** Creates a signed, expiring OAuth `state` that carries the tenant id. */
export function createOAuthState(tenantId: string, secret: string = env.sessionSecret(), now: number = Date.now()): string {
  const payload: StatePayload = { tid: tenantId, n: randomToken(12), exp: Math.floor(now / 1000) + TTL_SECONDS };
  return signPayload(secret, PURPOSE, payload);
}

/** Returns the tenant id if the state is authentic and not expired, otherwise null. */
export function verifyOAuthState(
  state: string | null | undefined,
  secret: string = env.sessionSecret(),
  now: number = Date.now(),
): string | null {
  const payload = verifySigned<StatePayload>(secret, PURPOSE, state, now);
  return payload && typeof payload.tid === "string" ? payload.tid : null;
}
