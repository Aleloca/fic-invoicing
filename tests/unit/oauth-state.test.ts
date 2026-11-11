import { describe, expect, it } from "vitest";
import { createOAuthState, verifyOAuthState } from "@/lib/oauth-state";

describe("OAuth state", () => {
  it("carries the account and project ids and verifies", () => {
    expect(verifyOAuthState(createOAuthState({ accountId: "acc_1", projectId: "prj_1" }))).toEqual({
      accountId: "acc_1",
      projectId: "prj_1",
    });
    expect(verifyOAuthState(createOAuthState({}))).toEqual({});
  });

  it("is unique per call", () => {
    expect(createOAuthState({ projectId: "p" })).not.toBe(createOAuthState({ projectId: "p" }));
  });

  it("rejects a tampered payload", () => {
    const state = createOAuthState({ projectId: "prj_1" });
    const [body, signature] = state.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    payload.a = "acc_evil";
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
    expect(verifyOAuthState(forged)).toBeNull();
  });

  it("rejects another secret, garbage and missing values", () => {
    const state = createOAuthState({ projectId: "prj_1" }, "another-secret-another-secret-123456");
    expect(verifyOAuthState(state)).toBeNull();
    expect(verifyOAuthState("garbage")).toBeNull();
    expect(verifyOAuthState(null)).toBeNull();
  });

  it("expires after 15 minutes", () => {
    const now = Date.now();
    const state = createOAuthState({ projectId: "prj_1" }, undefined, now);
    expect(verifyOAuthState(state, undefined, now + 14 * 60 * 1000)).toEqual({ projectId: "prj_1" });
    expect(verifyOAuthState(state, undefined, now + 16 * 60 * 1000)).toBeNull();
  });
});
