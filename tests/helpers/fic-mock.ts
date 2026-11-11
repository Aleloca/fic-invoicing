import { vi } from "vitest";

export interface FicMockOptions {
  /** Refresh token currently accepted by the fake FIC. */
  validRefreshToken?: string;
  refreshDelayMs?: number;
  /** Make the document creation fail with this HTTP status. */
  failCreateWith?: number;
}

export interface RecordedCall {
  method: string;
  url: URL;
  body: unknown;
  authorization: string | null;
}

/**
 * Installs a fake Fatture in Cloud API on global `fetch`.
 * Supports token refresh (with rotation), document creation, e-invoice send and PDF download.
 */
export function installFicMock(options: FicMockOptions = {}) {
  const state = {
    validRefreshToken: options.validRefreshToken ?? "refresh-0",
    refreshCount: 0,
    nextNumber: 1,
    failCreateWith: options.failCreateWith ?? 0,
    calls: [] as RecordedCall[],
  };

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const headers = new Headers(init?.headers);
    state.calls.push({ method, url, body, authorization: headers.get("authorization") });

    if (url.hostname === "files.fic.test") {
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
        status: 200,
        headers: { "Content-Type": "application/pdf", "Content-Length": "4" },
      });
    }
    if (url.hostname !== "fic.test") throw new Error(`Unexpected fetch to ${url.href}`);

    if (method === "POST" && url.pathname === "/oauth/token") {
      const payload = body as { grant_type: string; refresh_token?: string };
      if (payload.grant_type !== "refresh_token") return json(400, { error: "unsupported_grant_type" });
      state.refreshCount += 1;
      if (options.refreshDelayMs) await new Promise((r) => setTimeout(r, options.refreshDelayMs));
      if (payload.refresh_token !== state.validRefreshToken) {
        return json(400, { error: "invalid_grant", error_description: "refresh token is invalid or already used" });
      }
      const n = state.refreshCount;
      state.validRefreshToken = `refresh-${n}`;
      return json(200, { access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 86400, token_type: "bearer" });
    }

    let match = /^\/c\/(\d+)\/issued_documents$/.exec(url.pathname);
    if (method === "POST" && match) {
      if (state.failCreateWith) {
        return json(state.failCreateWith, { error: { message: "Validation failed", validation_result: { entity: "bad" } } });
      }
      const doc = body as { data: { numeration?: string }; options: { dry_run: boolean } };
      const number = state.nextNumber++;
      return json(200, {
        data: { id: doc.options.dry_run ? null : 5000 + number, number, numeration: doc.data.numeration ?? "" },
      });
    }

    match = /^\/c\/(\d+)\/issued_documents\/(\d+)\/preview_url$/.exec(url.pathname);
    if (method === "GET" && match) return json(200, { data: { url: `https://files.fic.test/${match[2]}.pdf` } });

    match = /^\/c\/(\d+)\/issued_documents\/(\d+)\/e_invoice\/send$/.exec(url.pathname);
    if (method === "POST" && match) return json(200, { data: { name: "IT0000_0001.xml", date: "2026-11-11" } });

    return json(404, { error: { message: `No mock for ${method} ${url.pathname}` } });
  });

  vi.stubGlobal("fetch", fetchMock);

  return {
    state,
    fetchMock,
    callsTo: (pathPattern: RegExp, method = "POST") =>
      state.calls.filter((c) => c.method === method && pathPattern.test(c.url.pathname)),
  };
}
