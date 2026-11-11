import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "./env";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const VERSION = "v1";

function loadKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes encoded as base64 (openssl rand -base64 32)");
  }
  return key;
}

/** Encrypts a UTF-8 string with AES-256-GCM. Output: `v1:<iv>:<tag>:<ciphertext>` (base64). */
export function encrypt(plaintext: string, base64Key: string = env.encryptionKey()): string {
  const key = loadKey(base64Key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Decrypts a value produced by {@link encrypt}. Throws if the data was tampered with. */
export function decrypt(payload: string, base64Key: string = env.encryptionKey()): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Unsupported encrypted payload format");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(ALGORITHM, loadKey(base64Key), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** HMAC-SHA256 with a purpose label, so one secret can sign different kinds of tokens safely. */
export function hmac(secret: string, purpose: string, data: string): string {
  return createHmac("sha256", secret).update(`${purpose}\n${data}`, "utf8").digest("base64url");
}

/** Constant-time string comparison (compares sha256 digests, so lengths may differ). */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Signs a JSON payload into a compact `<payload>.<signature>` token.
 * Payloads carry an `exp` (epoch seconds) that {@link verifySigned} enforces.
 */
export function signPayload(secret: string, purpose: string, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${hmac(secret, purpose, body)}`;
}

export function verifySigned<T extends { exp: number }>(
  secret: string,
  purpose: string,
  token: string | undefined | null,
  now: number = Date.now(),
): T | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, hmac(secret, purpose, body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < now) return null;
    return payload;
  } catch {
    return null;
  }
}
