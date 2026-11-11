import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signPayload, verifySigned } from "./crypto";
import { env } from "./env";

const COOKIE_NAME = "fici_admin";
const PURPOSE = "admin-session";
const TTL_SECONDS = 12 * 60 * 60;

function secureCookies(): boolean {
  try {
    return env.publicBaseUrl().startsWith("https://");
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

export async function createAdminSession(): Promise<void> {
  const token = signPayload(env.sessionSecret(), PURPOSE, { exp: Math.floor(Date.now() / 1000) + TTL_SECONDS });
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function destroyAdminSession(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

export async function isAdmin(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  return verifySigned(env.sessionSecret(), PURPOSE, token) !== null;
}

/** Use at the top of every admin page and server action. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/login");
}
