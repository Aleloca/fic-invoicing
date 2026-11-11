import { describe, expect, it } from "vitest";
import { createOAuthState, verifyOAuthState } from "@/lib/oauth-state";

describe("OAuth state", () => {
  it("carries the tenant id and verifies", () => {
    const state = createOAuthState("tenant_123");
    expect(verifyOAuthState(state)).toBe("tenant_123");
  });

  it("is unique per call", () => {
    expect(createOAuthState("t")).not.toBe(createOAuthState("t"));
  });

  it("rejects a tampered payload", () => {
    const state = createOAuthState("tenant_123");
    const [body, signature] = state.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    payload.tid = "tenant_evil";
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
    expect(verifyOAuthState(forged)).toBeNull();
  });

  it("rejects another secret, garbage and missing values", () => {
    const state = createOAuthState("tenant_123", "another-secret-another-secret-123456");
    expect(verifyOAuthState(state)).toBeNull();
    expect(verifyOAuthState("garbage")).toBeNull();
    expect(verifyOAuthState(null)).toBeNull();
  });

  it("expires after 15 minutes", () => {
    const now = Date.now();
    const state = createOAuthState("tenant_123", undefined, now);
    expect(verifyOAuthState(state, undefined, now + 14 * 60 * 1000)).toBe("tenant_123");
    expect(verifyOAuthState(state, undefined, now + 16 * 60 * 1000)).toBeNull();
  });
});
