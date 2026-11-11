---
stubwise:
  project: fattureincloud
  backlogItem: d441141b-efc3-4bd5-83f5-21064be92e33  # https://stubwise.thecove.it/backlog/d441141b-efc3-4bd5-83f5-21064be92e33
  ticket: 1  # https://stubwise.thecove.it/tickets/5c2211e0-7944-4722-b4d9-66e7ac31312c
---

# UI and UX redesign: Milano Moderna

## Why

The admin panel and the home page were built quickly, with a generic stylesheet. Now that fic-invoicing is open source, the home page is the first thing a visitor sees, and the panel is also used by non-technical people (accountants, administration staff, partners) who need to read invoice states without knowing OAuth or the API.

## Scope

- Presentation and UX only. The public API, the Prisma schema, the server actions and their form field names do not change.
- Every admin screen: login, tenants list, new tenant (API key reveal), tenant detail (Fatture in Cloud connection, invoice configuration, API key rotation), company choice, per-tenant invoices.
- A new read-only screen, **Invoices**, with the invoices of every tenant and filters by tenant, status and period. Retry and delete stay on the per-tenant page, where the actions already redirect.
- The home page (`/`) becomes a showcase of the project: what it does, why, how to install it, with links to GitHub (github.com/Aleloca/fic-invoicing), the API contract and the admin panel, and the "Not tax advice" warning.

## Visual direction

Product context is in `PRODUCT.md`; the direction contract for the panel is in `.impeccable/surfaces/src-app-admin.md`.

- **World:** Milan metro signage by Noorda and Unimark, plus the Olivetti identity. White ground, a solid signal-red navigation rail, near-black ink, a light warm grey for quiet fields, green only for live and issued. A bold, tight grotesque (Inter Tight), 2px black rules as section dividers, square corners.
- **Signature move:** each tenant's setup is drawn as a metro line with six stations (Created, Connected, Company, Configured, Dry run, Live), with the current stop marked. The tenants list shows one line per tenant, and the tenant page uses the same line as its header.
- **States in plain words:** invoice statuses (PENDING, ISSUED, FAILED, DELETED, dry run, sent to SDI) get a mark and a short explanation, not just a colour, so an accountant can read them.
- **To avoid:** a playful tone (no illustrations, emoji or jokes) and copying Fatture in Cloud's branding.

## Implementation plan

1. Design tokens and base components in `src/app/globals.css`, with Inter Tight and JetBrains Mono loaded through `next/font`.
2. Shared components: a setup line (stations computed from the tenant's fields), status marks with explanations, notices, buttons, fields.
3. Panel layout: a red rail on desktop that becomes a top band on mobile; nav for Tenants, Invoices, API and Sign out.
4. Screens: tenants list with lines, tenant detail split into numbered sections, company choice, new tenant and API key reveal, login.
5. Per-tenant invoices page restyled; new cross-tenant `/admin/invoices` page with filters and pagination.
6. Home page in the same world (structure picked on the decision page).
7. Checks: lint, typecheck, tests, screenshots at desktop and mobile widths, design detector, finish review, then DESIGN.md.
