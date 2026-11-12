"use server";

import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  afterFactorRemoved,
  afterPasskeyAdded,
  bumpSessionVersion,
  cancelTotpSetup,
  confirmTotp,
  disableTotp,
  factorState,
  generateRecoveryCodes,
  startTotpSetup,
  spendRecoveryCode,
  verifyTotp,
} from "@/lib/admin-security";
import { createAdminSession, hasPendingSession, requireAdmin, storeChallenge, takeChallenge } from "@/lib/admin-session";
import { authenticationOptions, registerPasskey, registrationOptions, verifyPasskey } from "@/lib/passkeys";
import { prisma } from "@/lib/prisma";
import { RateLimiter } from "@/lib/rate-limit";

const verifyLimiter = new RateLimiter(10);

async function limited(): Promise<boolean> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  return verifyLimiter.hit(`2fa:${ip}`) > 0;
}

/** The factors changed: other sessions end, this one carries on with the new version. */
async function renewSessions(): Promise<void> {
  await bumpSessionVersion();
  await createAdminSession();
}

// ----------------------------------------------------------------- Sign-in, second step

export interface VerifyState {
  error?: string;
}

export async function verifyCodeAction(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  if (!(await hasPendingSession())) redirect("/admin/login");
  if (await limited()) return { error: "Too many attempts, try again in a minute." };
  const code = String(formData.get("code") ?? "").trim();
  const method = formData.get("method") === "recovery" ? "recovery" : "totp";
  const ok = method === "recovery" ? await spendRecoveryCode(code) : await verifyTotp(code);
  if (!ok) return { error: method === "recovery" ? "Unknown or already used recovery code." : "Wrong or expired code." };
  await createAdminSession();
  redirect(method === "recovery" ? "/admin/security?notice=recovery_used" : "/admin");
}

export async function passkeyLoginOptionsAction(): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  if (!(await hasPendingSession())) return null;
  const options = await authenticationOptions();
  await storeChallenge("login", options.challenge);
  return options;
}

export async function passkeyLoginVerifyAction(response: AuthenticationResponseJSON): Promise<VerifyState> {
  if (!(await hasPendingSession())) return { error: "The sign-in expired. Enter the password again." };
  if (await limited()) return { error: "Too many attempts, try again in a minute." };
  const challenge = await takeChallenge("login");
  if (!challenge || !(await verifyPasskey(response, challenge))) return { error: "The passkey was not accepted." };
  await createAdminSession();
  return {};
}

// ----------------------------------------------------------------- Security page

export interface SecurityState {
  error?: string;
  recoveryCodes?: string[];
  done?: boolean;
}

export async function startTotpAction(): Promise<void> {
  await requireAdmin();
  await startTotpSetup();
  revalidatePath("/admin/security");
}

export async function cancelTotpAction(): Promise<void> {
  await requireAdmin();
  await cancelTotpSetup();
  revalidatePath("/admin/security");
}

export async function confirmTotpAction(_prev: SecurityState, formData: FormData): Promise<SecurityState> {
  await requireAdmin();
  const result = await confirmTotp(String(formData.get("code") ?? ""));
  if (!result) return { error: "Wrong code. Check the time on the phone and try the current code." };
  await renewSessions();
  revalidatePath("/admin/security");
  return { done: true, recoveryCodes: result.recoveryCodes ?? undefined };
}

export async function disableTotpAction(): Promise<void> {
  await requireAdmin();
  await disableTotp();
  await renewSessions();
  redirect("/admin/security?notice=totp_removed");
}

export async function passkeyRegisterOptionsAction(): Promise<PublicKeyCredentialCreationOptionsJSON> {
  await requireAdmin();
  const options = await registrationOptions();
  await storeChallenge("register", options.challenge);
  return options;
}

export async function passkeyRegisterVerifyAction(response: RegistrationResponseJSON, name: string): Promise<SecurityState> {
  await requireAdmin();
  const challenge = await takeChallenge("register");
  if (!challenge) return { error: "The request expired. Try again." };
  try {
    await registerPasskey(response, challenge, name);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The passkey could not be added." };
  }
  const recoveryCodes = await afterPasskeyAdded();
  await renewSessions();
  revalidatePath("/admin/security");
  return { done: true, recoveryCodes: recoveryCodes ?? undefined };
}

export async function renamePasskeyAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (name) await prisma.adminPasskey.updateMany({ where: { id: String(formData.get("id") ?? "") }, data: { name } });
  revalidatePath("/admin/security");
}

export async function removePasskeyAction(formData: FormData): Promise<void> {
  await requireAdmin();
  await prisma.adminPasskey.deleteMany({ where: { id: String(formData.get("id") ?? "") } });
  await afterFactorRemoved();
  await renewSessions();
  redirect("/admin/security?notice=passkey_removed");
}

export async function regenerateRecoveryAction(): Promise<SecurityState> {
  await requireAdmin();
  if (!(await factorState()).enabled) return { error: "Turn on a second factor first." };
  return { recoveryCodes: await generateRecoveryCodes() };
}
