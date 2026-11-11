---
stubwise:
  project: fattureincloud
  backlogItem: ed1892ed-cd43-4b41-9343-8ecd8753629f # https://stubwise.thecove.it/backlog/ed1892ed-cd43-4b41-9343-8ecd8753629f
  ticket: 4 # https://stubwise.thecove.it/tickets/8a85a40a-97fc-443d-a4c3-3c781a3f9649
---

# App Store payouts: invoices to Apple from the financial reports

## Problem

For an iOS-only project the money comes from Apple. Every fiscal month the admin reads the Payments page of App
Store Connect and issues by hand an invoice to Apple Distribution International in Fatture in Cloud. The service
should notice when Apple publishes a new financial report and prepare that invoice, with the euro amount already
estimated, so the admin only checks it and confirms.

## Findings (tested on the real account)

- `GET /v1/financeReports` (App Store Connect API, team key with Finance access, ES256 JWT) returns the financial
  report of a fiscal period as gzipped TSV: units and partner share per country, **in the sale currency**.
  `reportType=FINANCIAL`, `regionCode=ZZ`, `reportDate=<fiscal year>-<period>`: May 2026 is `2026-08`,
  September 2026 is `2026-12`. A period without sales returns 404.
- Apple's fiscal year ends on the last Saturday of September; periods follow a 5-4-4 week pattern per quarter
  (P1 is "October"). Matches every report downloaded (May, June, August, September 2026).
- The report has **no exchange rate and no euro amount**; no webhook announces it. The ECB reference rate of the
  day Apple updated the payment reproduced Apple's euro amounts exactly for September (0.57 GBP → 0.68 €,
  27.70 TRY → 0.50 €).

## Model

- `AppStoreAccount` (one per project): issuer id, key id, encrypted private key (.p8), vendor number, app name,
  and the invoice settings for Apple: customer (Apple Distribution International Ltd, IE9700053D, Hollyhill
  Industrial Estate, Hollyhill, T23 YK84 Cork, Ireland; recipient code `XXXXXXX`), line name, VAT type
  (non-taxable, art. 7-ter), payment account, payment method, SDI payment code (MP05, bank transfer), optional
  statement. `nextPeriod`: the first fiscal period not yet settled; `lastCheckedAt`, `lastError`.
- `AppStoreReport` (one per account and period): period code, start and end dates, lines per currency (amount,
  units, countries), ECB rates and their date, estimated euro cents (null when a currency has no ECB rate),
  status `READY` / `INVOICED` / `DISMISSED`, the invoice it produced.
- Invoices to Apple are ordinary `Invoice` rows of the project (category `EU_BUSINESS`, idempotency key
  `appstore:<period>`), so they appear in the invoice lists, can be retried and deleted like the others.

## Behaviour

- **Check.** Every 6 hours (in-process timer started by `instrumentation.ts`, disable with `APPSTORE_POLL=false`)
  and on demand from the admin, for each account and each ended period from `nextPeriod` on: download the report.
  Found → store it as `READY` with the ECB rates of that day and the estimate. 404 for a period ended more than 60
  days ago → no sales, skip it. `nextPeriod` advances over settled periods.
- **Setup.** Saving the credentials downloads the recent periods to check the key, and sets `nextPeriod` to the
  period after the latest existing report (those are already invoiced by hand).
- **Notice.** The projects list shows "App Store report ready: <month>" on the project; the project's App Store
  page lists the reports.
- **Issue.** For a `READY` report the admin sees the amounts per currency, the ECB rates and the estimate, edits
  the euro amount (from the Payments page), optionally adds the transaction id, picks the invoice date, and
  issues. One line: "<line name>", description "Proventi da distribuzione app <app>, report finanziario Apple
  periodo fiscale <Month YYYY>[, Transaction ID: <id>]", amount in euro, the configured VAT type, numeration and
  SDI sending of the project, dry run respected, B2B entity with `XXXXXXX`. Stamp duty: forfettario above €77.47,
  declared and borne by the seller (never charged to Apple), unless the project disables it.
- **Dismiss.** A report already invoiced elsewhere can be marked as such.

## Out of scope

- Reading the Payments page (no API): the euro amount stays editable.
- Several Apple entities per month (e.g. Apple Inc. for the Americas): one invoice per report, to the configured
  customer. To confirm with the accountant.
- Email or push notifications.

Not tax advice: the customer, the VAT nature and the statement must be confirmed by the accountant.
