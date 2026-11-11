# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Self-hosting developers (primary).** Mostly Italian developers and indie makers who sell online and run one instance of fic-invoicing for several of their own apps. They install it (Docker Compose or pm2), create a tenant per app, copy the API key, connect Fatture in Cloud through OAuth and set the fiscal configuration. They come back occasionally: a new app, a reconnect, a failed invoice.
- **Non-technical people around the business.** Accountants (commercialisti), administration staff or business partners who open the panel to check which invoices were issued, failed, are in dry run or were deleted. They read fiscal terms fluently but not API or OAuth jargon.
- **Visitors evaluating the project.** People arriving at an instance's home page or from GitHub who need to understand what the service does and how to install it.

## Product Purpose

A small, self-hostable, multi-tenant HTTP service that issues Italian electronic invoices (fatture elettroniche) through the Fatture in Cloud API v2, so each app does not reimplement OAuth with rotating refresh tokens, fiscal wording, stamp duty, country mapping, retries and idempotency. Success: an app sends one request with the customer's billing data and gets back a correct, idempotent e-invoice; the operator configures a tenant once and can trust and audit what happened.

## Positioning

One instance serves several apps at once: one API key and one Fatture in Cloud company per tenant, one OAuth app per instance. It encodes the fiscal rules of Italian sole traders (forfettario/ordinario statements, €2 stamp duty above €77.47, B2C/B2B routing, EU/extra-EU customers) and validates every invoice against Fatture in Cloud's totals endpoint before a document number is used. Open source (MIT), self-hosted, no SaaS.

## Operating Context

- Install: Docker Compose (MySQL 8) or a VPS with nginx and pm2. Configuration via environment variables.
- Admin panel: single admin password (shared by everyone who uses the panel); tenants list; new tenant (API key shown once); tenant page with Fatture in Cloud connection, company choice, invoice configuration (VAT type, payment account and method, numeration, fiscal regime, stamp duty mode and VAT type, fiscal statement overrides per category, dry run, auto-send to SDI), API key rotation; invoices list per tenant with status, retry of FAILED rows, deletion of invoices not yet sent to SDI, courtesy PDF.
- Invoice statuses: PENDING, ISSUED, FAILED, DELETED. Tenants start in dry-run mode.
- Public API under `/api/v1`, contract in `openapi.yaml`.

## Capabilities and Constraints

- Next.js (App Router, React 19, server actions), Prisma, MySQL. No UI library today; one global stylesheet.
- Redesign scope is presentation and UX only: API, Prisma schema, server actions and their form field names stay unchanged.
- Confirmed addition: a read-only cross-tenant invoices view (filters by status, tenant and period) for non-technical readers.
- Tone to avoid: playful (no illustrations, emoji or jokes around fiscal matters).
- Terminology: tenant, API key, dry run, live, SDI, stamp duty (imposta di bollo), fiscal regime (forfettario/ordinario), customer categories `IT_PRIVATE`, `EU_PRIVATE`, `EXTRAEU_PRIVATE`, `IT_BUSINESS`.
- The home page must not be indexed (`robots: noindex`) since it lives on each self-hosted instance.

## Brand Commitments

- Name: **fic-invoicing** (lowercase). No logo exists.
- Interface language: English, keeping Italian fiscal terms where they are the precise term.
- Voice: plain, factual, honest about limits. The README's "Not tax advice" warning (verify with your accountant, keep tenants in dry run until then) is a commitment and belongs on the home page.
- Not affiliated with Fatture in Cloud; must not borrow its branding.

## Evidence on Hand

- README.md (features, quickstart, env vars, OAuth app setup, API examples), openapi.yaml, docs/deploy-pm2.md, CONTRIBUTING.md, LICENSE (MIT).
- No users, testimonials, stars, benchmarks or screenshots exist: do not fabricate them.
- GitHub repository: https://github.com/Aleloca/fic-invoicing (confirmed for the home page).

## Product Principles

1. Trust over flair: an operator must always see what is real (live) and what is not (dry run), and what failed and why.
2. Readable by an accountant: invoice and status views make sense without knowing OAuth or the API.
3. Set up once, then get out of the way: configuration is guided and safe; destructive actions are explicit.
4. Honest about fiscal limits: never imply tax advice.
