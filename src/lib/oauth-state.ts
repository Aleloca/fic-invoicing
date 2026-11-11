import { env } from "./env";
import { randomToken, signPayload, verifySigned } from "./crypto";

const PURPOSE = "fic-oauth-state";
const TTL_SECONDS = 15 * 60;

/** What the OAuth round trip is for: reconnecting an account, and/or the project to return to. */
export interface OAuthTarget {
  /** Reconnect this account. Absent: connect a new (or matching) account. */
  accountId?: string;
  /** Return to this project and, if needed, choose its company. */
  projectId?: string;
}

interface StatePayload {
  a?: string;
  p?: string;
  n: string;
  exp: number;
  [key: string]: unknown;
}

/** Creates a signed, expiring OAuth `state` that carries the target. */
export function createOAuthState(
  target: OAuthTarget,
  secret: string = env.sessionSecret(),
  now: number = Date.now(),
): string {
  const payload: StatePayload = { n: randomToken(12), exp: Math.floor(now / 1000) + TTL_SECONDS };
  if (target.accountId) payload.a = target.accountId;
  if (target.projectId) payload.p = target.projectId;
  return signPayload(secret, PURPOSE, payload);
}

/** Returns the target if the state is authentic and not expired, otherwise null. */
export function verifyOAuthState(
  state: string | null | undefined,
  secret: string = env.sessionSecret(),
  now: number = Date.now(),
): OAuthTarget | null {
  const payload = verifySigned<StatePayload>(secret, PURPOSE, state, now);
  if (!payload) return null;
  const target: OAuthTarget = {};
  if (typeof payload.a === "string") target.accountId = payload.a;
  if (typeof payload.p === "string") target.projectId = payload.p;
  return target;
}
