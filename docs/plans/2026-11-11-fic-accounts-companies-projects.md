---
stubwise:
  project: fattureincloud
  backlogItem: 9546234c-5321-49ea-8775-094662e4cc6d # https://stubwise.thecove.it/backlog/9546234c-5321-49ea-8775-094662e4cc6d
  ticket: 3 # https://stubwise.thecove.it/tickets/c2cf79eb-2845-40c5-9b52-c20ef36b30a8
---

# Fatture in Cloud accounts, companies and projects

## Problem

Today every **tenant** holds its own Fatture in Cloud (FIC) OAuth tokens, its own company and its own copy of the
invoice settings. Adding a second app that invoices from the same FIC company means connecting to FIC again and
re-entering settings that are almost all identical. Tokens cannot simply be copied between tenants: FIC rotates
refresh tokens, so the first tenant that refreshes would invalidate the other's copy.

"Tenant" is also the wrong word: each one is an app/project that issues invoices through this service.

## Model

```
FicAccount  (one OAuth authorization: tokens, reconnect state)      1 ── n  Company
Company     (one FIC company of that account + default settings)    1 ── n  Project
Project     (an app: name, slug, API key, active, dry run, overrides)
```

- Several FIC accounts can be connected. One account can give access to several companies.
- **FicAccount**: `label`, `ficUserId`, `ficUserEmail`, encrypted access/refresh tokens, `tokenExpiresAt`,
  `connectedAt`, `needsReconnect`, `lastError`. Token refresh is serialized with a row lock on the account, so all the
  projects of an account share one token chain.
- **Company**: `accountId`, `ficCompanyId`, `name` (unique per account), and the defaults:
  `fiscalRegime`, `vatTypeId`, `nonTaxableVatTypeId`, `paymentAccountId`, `paymentMethodId`, `numeration`,
  `itemCode`, `fiscalStatements`, `eiPaymentMethod`, `stampDutyMode`, `stampDutyVatTypeId`, `sendToSdi`.
- **Project** (was Tenant): `name`, `slug`, `apiKeyHash`, `apiKeyPrefix`, `active`, `dryRun`, `companyId?`, plus a
  nullable override for every company default except `fiscalRegime` (a fact of the company, never overridden).
  - `null` = inherit the company value.
  - Text overrides (`numeration`, `itemCode`) store `""` to mean "explicitly empty" (e.g. the company default
    numeration when the company uses `/A`).
  - `fiscalStatements` merge per customer category: project text, else company text, else the regime preset.
- **Invoice**: `tenantId` → `projectId`; new `companyId` records the company that issued it, so deleting it or
  retrying the SDI send later talks to the right company even if the project moved to another one.

## Behaviour

- Effective configuration = `resolveProjectConfig(company, project)`, used by invoice issuing and by the setup line.
- Readiness: no company → `fic_not_connected`; account flagged → `fic_reconnect_required`; incomplete effective
  configuration → `tenant_not_configured` (public error code kept for compatibility, documented as historical).
- Connecting:
  - **New account**: OAuth from the Fatture in Cloud page or from a project. The callback reads `/user/info`; if an
    account with the same FIC user id exists, its tokens are replaced instead of creating a duplicate.
  - **Reconnect**: OAuth bound to an existing account; clears `needsReconnect` for every project using it.
  - The OAuth `state` carries the purpose (`new` with optional project id, or `reconnect` with the account id).
- Choosing a project's company lists, grouped by account, every company each connected account can access; picking
  one creates the Company row on first use. Projects can share a company.
- Disconnecting an account clears its tokens: its projects stop issuing until it is reconnected. An account with
  no companies in use can be removed.
- The company page shows which projects use it and which of them override each field, so a change to a default
  says before saving which projects it affects.
- The project page shows every inheritable field as *Company default* (with the inherited value) or *Custom*, with
  a way back to the default.
- A warning shows when two projects share a company and the same effective numeration: their invoices share one
  number sequence.

## Migration (data preserved, nobody reconnects)

1. Create `fic_accounts` and `companies`.
2. For every tenant with tokens: one account with its tokens. For every tenant with a company: one company with the
   tenant's current settings.
3. Rename `tenants` → `projects`, add `companyId`, drop token and company columns, make the overridable settings
   nullable. Connected tenants get no overrides (everything comes from their new company). Unconnected tenants keep
   non-default values as overrides.
4. Rename `invoices.tenantId` → `projectId`, add `invoices.companyId` filled from the project's company.

## Naming

"Tenant" becomes **Project** everywhere: UI, docs, code, database, routes (`/admin/projects`, old `/admin/tenants`
URLs redirect). The public API keeps its paths and the `tenant_not_configured` error code.

## Out of scope

- Live inheritance between projects.
- Per-project fiscal regime.
