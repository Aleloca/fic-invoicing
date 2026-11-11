import { gzipSync } from "node:zlib";
import { vi } from "vitest";

export interface FicMockOptions {
  /** Refresh token currently accepted by the fake FIC. */
  validRefreshToken?: string;
  refreshDelayMs?: number;
  /** Make the document creation fail with this HTTP status. */
  failCreateWith?: number;
  /** Make the totals endpoint fail with this HTTP status. */
  failTotalsWith?: number;
  /** The FIC user behind every access token (GET /user/info). */
  user?: { id: number; name: string; email: string };
  /** Companies the user can access (GET /user/companies). */
  companies?: Array<{ id: number; name: string }>;
  /** App Store Connect FINANCIAL reports (TSV) by fiscal period; other periods return 404. */
  appleReports?: Record<string, string>;
  /** Apps of the Apple account (GET /v1/apps). */
  appleApps?: Array<{ id: string; name: string; sku: string }>;
  /** Monthly Sales and Trends summaries (TSV) by calendar month; other months return 404. */
  appleSales?: Record<string, string>;
  /** ECB reference rates (units per euro) returned for any day. */
  ecbRates?: Record<string, number>;
}

interface MockDocumentData {
  numeration?: string;
  e_invoice?: boolean;
  use_gross_prices?: boolean;
  stamp_duty?: number;
  items_list?: Array<{ net_price?: number; gross_price?: number; qty?: number }>;
  payments_list?: Array<{ amount: number }>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Totals as the real FIC computes them for our documents (0% VAT lines).
 * Like real FIC, `stamp_duty` is NOT added to the amount due of an e-invoice: it is only declared.
 */
export function mockTotals(data: MockDocumentData) {
  const items = data.items_list ?? [];
  const amountGross = round2(
    items.reduce((sum, i) => sum + (data.use_gross_prices ? (i.gross_price ?? 0) : (i.net_price ?? i.gross_price ?? 0)) * (i.qty ?? 1), 0),
  );
  const stampDuty = data.stamp_duty ?? 0;
  const amountDue = round2(amountGross + (data.e_invoice ? 0 : stampDuty));
  const paymentsSum = round2((data.payments_list ?? []).reduce((sum, p) => sum + p.amount, 0));
  return {
    amount_net: amountGross,
    amount_vat: 0,
    amount_gross: amountGross,
    amount_due: amountDue,
    stamp_duty: stampDuty,
    payments_sum: paymentsSum,
  };
}

export interface RecordedCall {
  method: string;
  url: URL;
  body: unknown;
  authorization: string | null;
}

/**
 * Installs a fake Fatture in Cloud API on global `fetch`.
 * Supports token refresh (with rotation), document totals, creation and deletion, e-invoice send and PDF download.
 */
export function installFicMock(options: FicMockOptions = {}) {
  const state = {
    validRefreshToken: options.validRefreshToken ?? "refresh-0",
    refreshCount: 0,
    nextNumber: 1,
    failCreateWith: options.failCreateWith ?? 0,
    failTotalsWith: options.failTotalsWith ?? 0,
    /** When set, the totals endpoint reports this amount due instead of the computed one. */
    amountDueOverride: null as number | null,
    /** Ids of documents created by the fake FIC and not deleted. */
    documents: new Set<number>(),
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
    if (url.hostname === "api.appstoreconnect.apple.com" && url.pathname === "/v1/financeReports") {
      const tsv = options.appleReports?.[url.searchParams.get("filter[reportDate]") ?? ""];
      if (tsv === undefined) return json(404, { errors: [{ status: "404", code: "NOT_FOUND", title: "The specified resource does not exist" }] });
      return new Response(new Uint8Array(gzipSync(tsv)), { status: 200, headers: { "Content-Type": "application/a-gzip" } });
    }
    if (url.hostname === "api.appstoreconnect.apple.com" && url.pathname === "/v1/apps") {
      return json(200, { data: (options.appleApps ?? []).map((a) => ({ type: "apps", id: a.id, attributes: { name: a.name, sku: a.sku } })), links: {} });
    }
    if (url.hostname === "api.appstoreconnect.apple.com" && url.pathname === "/v1/salesReports") {
      const tsv = options.appleSales?.[url.searchParams.get("filter[reportDate]") ?? ""];
      if (tsv === undefined) return json(404, { errors: [{ status: "404", code: "NOT_FOUND" }] });
      return new Response(new Uint8Array(gzipSync(tsv)), { status: 200, headers: { "Content-Type": "application/a-gzip" } });
    }
    if (url.hostname === "data-api.ecb.europa.eu") {
      const wanted = /\/EXR\/D\.([A-Z+]+)\.EUR/.exec(url.pathname)?.[1].split("+") ?? [];
      const day = url.searchParams.get("endPeriod") ?? "2026-10-28";
      const rows = wanted
        .filter((c) => options.ecbRates?.[c] !== undefined)
        .map((c) => `EXR.D.${c}.EUR.SP00.A,D,${c},EUR,SP00,A,${day},${options.ecbRates![c]},A`);
      if (rows.length === 0) return new Response("No results found.", { status: 404 });
      return new Response(["KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS", ...rows].join("\n"), { status: 200 });
    }
    if (url.hostname !== "fic.test") throw new Error(`Unexpected fetch to ${url.href}`);

    if (method === "POST" && url.pathname === "/oauth/token") {
      const payload = body as { grant_type: string; refresh_token?: string; code?: string };
      if (payload.grant_type === "authorization_code") {
        state.validRefreshToken = `refresh-code-${payload.code}`;
        return json(200, {
          access_token: `access-code-${payload.code}`,
          refresh_token: state.validRefreshToken,
          expires_in: 86400,
          token_type: "bearer",
        });
      }
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

    if (method === "GET" && url.pathname === "/user/info") {
      return json(200, { data: options.user ?? { id: 77, name: "Mario Rossi", email: "mario@example.com" } });
    }
    if (method === "GET" && url.pathname === "/user/companies") {
      return json(200, { data: { companies: options.companies ?? [{ id: 4242, name: "ACME srl" }] } });
    }

    let match = /^\/c\/(\d+)\/issued_documents\/totals$/.exec(url.pathname);
    if (method === "POST" && match) {
      if (state.failTotalsWith) {
        return json(state.failTotalsWith, { error: { message: "Totals failed", validation_result: { items_list: "bad" } } });
      }
      const totals = mockTotals((body as { data: MockDocumentData }).data);
      if (state.amountDueOverride !== null) totals.amount_due = state.amountDueOverride;
      return json(200, { data: totals });
    }

    match = /^\/c\/(\d+)\/issued_documents$/.exec(url.pathname);
    if (method === "POST" && match) {
      if (state.failCreateWith) {
        return json(state.failCreateWith, { error: { message: "Validation failed", validation_result: { entity: "bad" } } });
      }
      // Real FIC ignores `options.dry_run` and always creates the document.
      const doc = body as { data: MockDocumentData };
      const totals = mockTotals(doc.data);
      if (Math.abs(totals.payments_sum - totals.amount_due) > 0.005) {
        return json(422, { error: { message: "Il totale dei pagamenti non corrisponde al totale da pagare." } });
      }
      const number = state.nextNumber++;
      state.documents.add(5000 + number);
      return json(200, {
        data: { id: 5000 + number, number, numeration: doc.data.numeration ?? "", amount_due: totals.amount_due },
      });
    }

    match = /^\/c\/(\d+)\/issued_documents\/(\d+)$/.exec(url.pathname);
    if (method === "DELETE" && match) {
      if (!state.documents.delete(Number(match[2]))) return json(404, { error: { message: "Document not found" } });
      return new Response(null, { status: 200 });
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
