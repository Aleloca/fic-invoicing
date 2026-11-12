import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, hotp, matchTotp, otpauthUri, totpCode } from "@/lib/totp";

// RFC 6238 appendix B, SHA-1 seed "12345678901234567890".
const SEED = Buffer.from("12345678901234567890");
const SECRET = base32Encode(SEED);

describe("TOTP", () => {
  it("round-trips base32", () => {
    expect(SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(SECRET).equals(SEED)).toBe(true);
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });

  it("matches the RFC 4226 HOTP vectors", () => {
    expect(hotp(SEED, 0)).toBe("755224");
    expect(hotp(SEED, 9)).toBe("520489");
  });

  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("at %i seconds the code is %s", (seconds, code) => {
    expect(totpCode(SECRET, seconds * 1000)).toBe(code);
  });

  it("accepts one step of drift and nothing more", () => {
    const now = 1234567890_000;
    expect(matchTotp(SECRET, "005924", now)).toBe(41152263);
    expect(matchTotp(SECRET, totpCode(SECRET, now - 30_000), now)).toBe(41152262);
    expect(matchTotp(SECRET, totpCode(SECRET, now + 30_000), now)).toBe(41152264);
    expect(matchTotp(SECRET, totpCode(SECRET, now - 90_000), now)).toBeNull();
    expect(matchTotp(SECRET, "005 924", now)).toBe(41152263);
    expect(matchTotp(SECRET, "abc", now)).toBeNull();
  });

  it("builds the otpauth URI", () => {
    expect(otpauthUri("ABC", "admin", "fic-invoicing")).toBe(
      "otpauth://totp/fic-invoicing%3Aadmin?secret=ABC&issuer=fic-invoicing&algorithm=SHA1&digits=6&period=30",
    );
  });
});
