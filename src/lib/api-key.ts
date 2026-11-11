import { randomToken, sha256Hex } from "./crypto";

export const API_KEY_PREFIX = "fici_";

export interface GeneratedApiKey {
  plaintext: string;
  hash: string;
  /** Short non-secret prefix shown in the admin panel. */
  displayPrefix: string;
}

export function generateApiKey(): GeneratedApiKey {
  const plaintext = `${API_KEY_PREFIX}${randomToken(32)}`;
  return {
    plaintext,
    hash: hashApiKey(plaintext),
    displayPrefix: plaintext.slice(0, API_KEY_PREFIX.length + 6),
  };
}

export function hashApiKey(plaintext: string): string {
  return sha256Hex(plaintext);
}
