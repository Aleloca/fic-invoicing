import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { API_KEY_PREFIX, generateApiKey, hashApiKey } from "@/lib/api-key";
import { decrypt, encrypt, signPayload, verifySigned } from "@/lib/crypto";

describe("AES-256-GCM", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("secret-token");
    const b = encrypt("secret-token");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(decrypt(a)).toBe("secret-token");
    expect(decrypt(b)).toBe("secret-token");
  });

  it("detects tampering", () => {
    const parts = encrypt("secret-token").split(":");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 0xff;
    parts[3] = data.toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("fails with a different key", () => {
    const value = encrypt("secret-token");
    expect(() => decrypt(value, randomBytes(32).toString("base64"))).toThrow();
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encrypt("x", randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("API keys", () => {
  it("have the fici_ prefix and are stored as sha256", () => {
    const key = generateApiKey();
    expect(key.plaintext.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key.plaintext.length).toBeGreaterThan(40);
    expect(key.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key.plaintext)).toBe(key.hash);
    expect(generateApiKey().plaintext).not.toBe(key.plaintext);
  });
});

describe("signed payloads", () => {
  it("verify only with the same secret and purpose", () => {
    const token = signPayload("s1", "p", { exp: Math.floor(Date.now() / 1000) + 60, v: 1 });
    expect(verifySigned("s1", "p", token)).toMatchObject({ v: 1 });
    expect(verifySigned("s2", "p", token)).toBeNull();
    expect(verifySigned("s1", "other", token)).toBeNull();
  });
});
