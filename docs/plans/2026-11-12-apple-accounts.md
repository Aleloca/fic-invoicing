---
stubwise:
  project: fattureincloud
  backlogItem: e55dadb8-7f59-4096-9353-b7b30f46d80f # https://stubwise.thecove.it/backlog/e55dadb8-7f59-4096-9353-b7b30f46d80f
  ticket: 5 # https://stubwise.thecove.it/tickets/bb002519-a11e-4b44-87c7-d820ab1ab496
---

# Apple developer accounts shared by projects

Follow-up of `2026-11-11-app-store-invoices.md`. The App Store Connect configuration was tied to one project, but
one Apple developer account can sell several apps, each of a different project, and Apple pays (and is invoiced)
once per fiscal month for all of them.

## Model

- **AppleAccount** (was AppStoreAccount, no longer per project): label, issuer id, key id, encrypted .p8, vendor
  number, the Fatture in Cloud **company** that issues the invoices to Apple, the invoice settings (customer, line
  name, VAT type, payment account and method, SDI payment code, statement), **dry run**, next period, last check.
- **AppleProduct**: a product seen in the reports (Apple identifier, SKU, title; for in-app purchases the purchase,
  not the app), assigned once to a **project**. Unassigned products are proposed a project from the SKU or title.
- **AppStoreReport**: per account and fiscal period; lines per product and currency.
- **Invoice**: `projectId` becomes optional; invoices to Apple belong to the Apple account (`appleAccountId`).

## Behaviour

- Checks as before, per account. New products are recorded unassigned.
- A report can be invoiced once all its products are assigned. **One invoice per report, one line per project**:
  "Distribuzione applicazioni mobili", "Proventi da distribuzione app <project>, report finanziario Apple periodo
  fiscale <Mese YYYY>[, Transaction ID: …]". Each line's euro amount is prefilled with the ECB estimate of that
  project's proceeds and editable; the page shows the total to compare with the Payments page.
- Numeration and SDI sending from the account's company defaults; dry run from the account; stamp duty as before.
- Admin: *Apple* in the navigation (accounts, reports, products, settings); the projects list flags projects with a
  report ready; the project page lists its Apple products. Invoices to Apple show as "Apple · <account>" in the
  invoices list and are retried or deleted there.

## Migration

The account configured on ZenTap becomes the first Apple account, with ZenTap's company and dry run. Reports not
invoiced yet are dropped and re-downloaded with product details (next period moved back accordingly).
