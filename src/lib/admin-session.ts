import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionVersion } from "./admin-security";
import { signPayload, verifySigned } from "./crypto";
import { env } from "./env";

const COOKIE_NAME = "fici_admin";
const PURPOSE = "admin-session";
const TTL_SECONDS = 12 * 60 * 60;

/** Password accepted, second factor still due. */
const PENDING_COOKIE = "fici_admin_2fa";
const PENDING_PURPOSE = "admin-2fa";
const PENDING_TTL_SECONDS = 5 * 60;

/** WebAuthn challenge between the options and the response. */
const CHALLENGE_COOKIE = "fici_webauthn";
const CHALLENGE_TTL_SECONDS = 5 * 60;

function secureCookies(): boolean {
  try {
    return env.publicBaseUrl().startsWith("https://");
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

async function setCookie(name: string, value: string, maxAge: number): Promise<void> {
  (await cookies()).set(name, value, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge });
}

export async function createAdminSession(): Promise<void> {
  const v = await sessionVersion();
  await setCookie(COOKIE_NAME, signPayload(env.sessionSecret(), PURPOSE, { exp: Math.floor(Date.now() / 1000) + TTL_SECONDS, v }), TTL_SECONDS);
  (await cookies()).delete(PENDING_COOKIE);
}

export async function destroyAdminSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  jar.delete(PENDING_COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  const payload = verifySigned<{ exp: number; v?: number }>(env.sessionSecret(), PURPOSE, token);
  // Sessions from before versioning count as version 1.
  return payload !== null && (payload.v ?? 1) === (await sessionVersion());
}

/** Use at the top of every admin page and server action. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}

export async function createPendingSession(): Promise<void> {
  await setCookie(
    PENDING_COOKIE,
    signPayload(env.sessionSecret(), PENDING_PURPOSE, { exp: Math.floor(Date.now() / 1000) + PENDING_TTL_SECONDS }),
    PENDING_TTL_SECONDS,
  );
}

export async function hasPendingSession(): Promise<boolean> {
  return verifySigned(env.sessionSecret(), PENDING_PURPOSE, (await cookies()).get(PENDING_COOKIE)?.value) !== null;
}

export async function storeChallenge(kind: "login" | "register", challenge: string): Promise<void> {
  await setCookie(
    CHALLENGE_COOKIE,
    signPayload(env.sessionSecret(), `webauthn-${kind}`, { exp: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS, challenge }),
    CHALLENGE_TTL_SECONDS,
  );
}

/** The stored challenge, once: it is removed as it is read. */
export async function takeChallenge(kind: "login" | "register"): Promise<string | null> {
  const jar = await cookies();
  const payload = verifySigned<{ exp: number; challenge: string }>(env.sessionSecret(), `webauthn-${kind}`, jar.get(CHALLENGE_COOKIE)?.value);
  jar.delete(CHALLENGE_COOKIE);
  return payload?.challenge ?? null;
}
