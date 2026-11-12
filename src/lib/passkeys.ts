/**
 * WebAuthn passkeys as a second factor of the admin sign-in.
 * The relying party is the host of PUBLIC_BASE_URL; passkeys made on one host do not work on another.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { Prisma } from "@prisma/client";
import { env } from "./env";
import { prisma } from "./prisma";

const RP_NAME = "fic-invoicing";
const USER_ID = new TextEncoder().encode("fic-invoicing-admin");

export function relyingParty(): { rpID: string; origin: string } {
  const origin = env.publicBaseUrl();
  return { rpID: new URL(origin).hostname, origin };
}

function transportsOf(value: Prisma.JsonValue | null): string[] | undefined {
  return Array.isArray(value) ? (value as string[]) : undefined;
}

export async function registrationOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const existing = await prisma.adminPasskey.findMany({ select: { credentialId: true, transports: true } });
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: relyingParty().rpID,
    userName: "admin",
    userDisplayName: "fic-invoicing admin",
    userID: USER_ID,
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: transportsOf(p.transports) })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
}

/** Verifies a new passkey and stores it. Throws when the response does not match the challenge. */
export async function registerPasskey(response: RegistrationResponseJSON, challenge: string, name: string): Promise<void> {
  const { rpID, origin } = relyingParty();
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
  if (!result.verified) throw new Error("The passkey could not be verified.");
  const { credential } = result.registrationInfo;
  await prisma.adminPasskey.create({
    data: {
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: (credential.transports ?? response.response.transports ?? []) as Prisma.InputJsonValue,
      name: name.trim().slice(0, 80) || "Passkey",
    },
  });
}

export async function authenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const passkeys = await prisma.adminPasskey.findMany({ select: { credentialId: true, transports: true } });
  return generateAuthenticationOptions({
    rpID: relyingParty().rpID,
    allowCredentials: passkeys.map((p) => ({ id: p.credentialId, transports: transportsOf(p.transports) })),
    userVerification: "preferred",
  });
}

/** True when the response is signed by one of the stored passkeys for this challenge. */
export async function verifyPasskey(response: AuthenticationResponseJSON, challenge: string, now: Date = new Date()): Promise<boolean> {
  const passkey = await prisma.adminPasskey.findUnique({ where: { credentialId: response.id } });
  if (!passkey) return false;
  const { rpID, origin } = relyingParty();
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: transportsOf(passkey.transports),
      },
    });
    if (!result.verified) return false;
    await prisma.adminPasskey.update({
      where: { id: passkey.id },
      data: { counter: result.authenticationInfo.newCounter, lastUsedAt: now },
    });
    return true;
  } catch {
    return false;
  }
}
