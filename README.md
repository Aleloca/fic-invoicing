# fic-invoicing

A small, self-hostable HTTP service that issues **Italian electronic invoices** (fatture elettroniche)
through the [Fatture in Cloud](https://www.fattureincloud.it/) API v2, for **several apps at once**.

Each app ("tenant") gets an API key and connects its own Fatture in Cloud company through OAuth.
Your app sends the customer's billing data with every request; the service builds a correct e-invoice
payload (fiscal statements, stamp duty, B2C/B2B routing, country names), calls Fatture in Cloud, and keeps
an idempotent record of what happened.

> **Not tax advice.** The fiscal statements, stamp duty rule and VAT handling shipped here are common
> setups for Italian sole traders. Your situation may differ. Verify every statement and setting with your
> accountant (commercialista) before you send real invoices, and keep tenants in dry-run mode until then.

## Why

Selling online from Italy means issuing an e-invoice for every sale, often to private customers abroad.
Wiring Fatture in Cloud into every project means reimplementing OAuth with rotating refresh tokens,
fiscal wording, country mapping, retries and idempotency each time. This service does it once.

## Features

- Multi-tenant: one API key and one Fatture in Cloud company per tenant, one OAuth app per instance.
- Customer categories: `IT_PRIVATE`, `EU_PRIVATE`, `EXTRAEU_PRIVATE` (B2C) and `IT_BUSINESS` (B2B with SDI code or PEC).
- Fiscal regimes: `FORFETTARIO` and `ORDINARIO`, with preset statements (art. 1 c. 58 L. 190/2014, art. 7-ter DPR 633/72) overridable per tenant and per category.
- €2 stamp duty (imposta di bollo) on forfettario invoices above €77.47: charged to the customer as a separate line, borne by the seller, or disabled, per tenant.
- Idempotent creation (`idempotencyKey`), a PENDING row written before the FIC call, FAILED rows that can be retried.
- Dry-run mode per tenant (default on): the invoice is validated with Fatture in Cloud's totals endpoint and nothing is created in Fatture in Cloud.
- Every real invoice is pre-checked with the same totals endpoint, so a payment mismatch fails before a document number is used.
- Optional automatic transmission to SDI after creation.
- Courtesy PDF download streamed from Fatture in Cloud.
- OAuth tokens encrypted at rest (AES-256-GCM); token refresh serialized per tenant with a database row lock, because Fatture in Cloud rotates refresh tokens.
- Admin panel: tenants, FIC connection and company choice, dropdowns for VAT types, payment accounts and methods, invoice list with retry.
- Customer personal data is not kept after success (configurable).

## Quickstart (Docker Compose)

```bash
git clone <this repository> fic-invoicing && cd fic-invoicing
cp .env.example .env
# Fill in ENCRYPTION_KEY, SESSION_SECRET, ADMIN_PASSWORD, FIC_CLIENT_ID, FIC_CLIENT_SECRET, PUBLIC_BASE_URL
#   openssl rand -base64 32   # ENCRYPTION_KEY
#   openssl rand -base64 48   # SESSION_SECRET
docker compose up -d --build
curl http://localhost:3000/api/v1/health    # {"status":"ok","database":"ok"}
```

Compose starts MySQL 8, runs `prisma migrate deploy` once, then starts the app on port 3000
(`APP_PORT` to change it). Then:

1. Open `http://localhost:3000/admin` and sign in with `ADMIN_PASSWORD`.
2. Create a tenant. **Copy the API key**: it is shown once.
3. On the tenant page click **Connect Fatture in Cloud**, authorize, and choose the company if your user has more than one.
4. Choose the VAT type, payment account and payment method, set the numeration (for example `/A`) and the fiscal regime. With the default stamp duty mode (*Charged to customer*) also choose the **stamp duty VAT type** (a VAT type excluded under art. 15 DPR 633/72). Save.
5. Send a test invoice (the tenant starts in dry-run mode). When the result is right, untick **Dry run**.

For a VPS with nginx and pm2 instead of Docker, see [docs/deploy-pm2.md](docs/deploy-pm2.md).

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | | MySQL connection string. Compose sets it for you. |
| `ENCRYPTION_KEY` | yes | | 32 random bytes, base64. Encrypts FIC tokens. Changing it forces every tenant to reconnect. |
| `SESSION_SECRET` | yes | | At least 32 characters. Signs the admin session cookie and the OAuth `state`. |
| `ADMIN_PASSWORD` | yes | | Password of the single admin user. |
| `FIC_CLIENT_ID` | yes | | Client ID of your Fatture in Cloud OAuth app. |
| `FIC_CLIENT_SECRET` | yes | | Client secret of your Fatture in Cloud OAuth app. |
| `PUBLIC_BASE_URL` | yes | | Public URL of the service, no trailing slash. Cookies are `Secure` when it starts with `https://`. |
| `PURGE_PAYLOAD_ON_SUCCESS` | no | `true` | Delete the stored request payload (customer data) when an invoice is ISSUED. |
| `RATE_LIMIT_PER_MINUTE` | no | `60` | Requests per minute per API key (in memory, per process). |
| `FIC_API_BASE_URL` | no | `https://api-v2.fattureincloud.it` | Only for testing against a mock server. |
| `TEST_DATABASE_URL` | tests only | | Enables integration tests. The database name must contain `test`; it is wiped. |

## Creating the Fatture in Cloud OAuth app

1. Sign in to the [Fatture in Cloud developer console](https://developers.fattureincloud.it/) and create an app with **OAuth 2.0 authorization code** flow.
2. Set the redirect URI to **`${PUBLIC_BASE_URL}/api/oauth/fic/callback`**, for example
   `https://invoices.example.com/api/oauth/fic/callback` (and `http://localhost:3000/api/oauth/fic/callback` for local use, if the console allows it).
3. The service requests these scopes:

   | Scope | Why |
   | --- | --- |
   | `issued_documents.invoices:r` | read invoices (PDF preview URL) |
   | `issued_documents.invoices:a` | create invoices and send e-invoices to SDI |
   | `entity.clients:r` | read clients |
   | `entity.suppliers:r` | read suppliers |
   | `settings:r` | read VAT types, payment accounts and payment methods |

4. Copy the client ID and secret into `FIC_CLIENT_ID` and `FIC_CLIENT_SECRET`.

One OAuth app serves every tenant. Each tenant authorizes with the Fatture in Cloud user that owns its company.

## API

Base path `/api/v1`. Authenticate with `Authorization: Bearer <tenant api key>`.
The full contract is in [openapi.yaml](openapi.yaml). Errors always look like:

```json
{ "error": { "code": "validation_error", "message": "Invalid request body", "details": [{ "path": "customer.fiscalCode", "message": "Invalid fiscal code" }] } }
```

### Create an invoice

```bash
curl -X POST https://invoices.example.com/api/v1/invoices \
  -H "Authorization: Bearer $FICI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "order-1001",
    "externalRef": "checkout_123",
    "amountCents": 10000,
    "description": "Consulting session",
    "customer": {
      "category": "IT_PRIVATE",
      "firstName": "Mario",
      "lastName": "Rossi",
      "fiscalCode": "RSSMRA85T10A562S",
      "address": "Via Roma 1",
      "zipCode": "00100",
      "city": "Roma",
      "province": "RM",
      "countryCode": "IT",
      "email": "mario.rossi@example.com"
    }
  }'
```

`201 Created`:

```json
{
  "id": "cmexample0001",
  "idempotencyKey": "order-1001",
  "externalRef": "checkout_123",
  "status": "ISSUED",
  "customerCategory": "IT_PRIVATE",
  "number": "1/A",
  "ficDocumentId": 123456789,
  "amountCents": 10000,
  "stampDutyCents": 200,
  "dryRun": false,
  "errorMessage": null,
  "attempts": 1,
  "sdi": { "sentAt": null, "error": null },
  "createdAt": "2026-11-11T15:08:00.408Z",
  "updatedAt": "2026-11-11T15:08:00.462Z"
}
```

Behaviour:

- **Idempotency.** The same `idempotencyKey` for the same tenant returns the existing invoice with `200` and never calls Fatture in Cloud twice. A FAILED invoice is returned as is; use the retry endpoint.
- **Totals pre-check.** Before creating a document the service sends the same payload to Fatture in Cloud's `POST /c/{company_id}/issued_documents/totals`, which computes the totals without creating anything. If the recorded payment does not equal the amount due computed by Fatture in Cloud, the invoice is `FAILED` with both amounts in `errorMessage` and no document number is consumed.
- **Failures.** If Fatture in Cloud rejects the invoice (totals or creation), the row becomes `FAILED` and the response is `502` with the invoice plus `"error": { "code": "fic_error", ... }`.
- **Dry run.** `"dryRun": true` forces a dry run. `false` cannot turn off a tenant that is in dry-run mode. Fatture in Cloud has no dry run on document creation (its `dry_run` option is ignored and the document is created), so a dry run only calls the totals endpoint: nothing is created in Fatture in Cloud and nothing is sent to SDI. A dry run that passes is `ISSUED` with `dryRun: true`, `ficDocumentId: null` and `number: null`; a payment mismatch or a Fatture in Cloud error makes it `FAILED`. The totals endpoint does not run every check of document creation, so a passing dry run is a strong but not complete validation.
- **Not ready.** A tenant that is not connected, needs reconnection or misses configuration gets `409` (`fic_not_connected`, `fic_reconnect_required`, `tenant_not_configured`) and no invoice row is created.
- `paidAt` (`YYYY-MM-DD`) sets the document and payment date; default is today in Europe/Rome.

Other categories:

```jsonc
// EU private customer
{ "category": "EU_PRIVATE", "firstName": "Anna", "lastName": "Schmidt", "address": "Hauptstr. 1",
  "zipCode": "10115", "city": "Berlin", "countryCode": "DE", "email": "anna@example.com" }

// Italian business (B2B): sdiCode, or pec when the customer has no recipient code
{ "category": "IT_BUSINESS", "companyName": "Example S.r.l.", "vatNumber": "12345678903",
  "sdiCode": "ABC1234", "address": "Via Milano 2", "zipCode": "20100", "city": "Milano",
  "province": "MI", "countryCode": "IT", "email": "billing@example.com" }
```

### Read, download, retry

```bash
curl -H "Authorization: Bearer $FICI_API_KEY" https://invoices.example.com/api/v1/invoices/$ID
curl -H "Authorization: Bearer $FICI_API_KEY" -o invoice.pdf https://invoices.example.com/api/v1/invoices/$ID/pdf
curl -X POST -H "Authorization: Bearer $FICI_API_KEY" https://invoices.example.com/api/v1/invoices/$ID/retry
curl https://invoices.example.com/api/v1/health
```

- `pdf` returns `409` when the invoice is not ISSUED or is a dry run (nothing exists in Fatture in Cloud).
- `retry` works on `FAILED` invoices (and on ISSUED invoices whose automatic SDI send failed). It uses the tenant's current configuration. It returns `409` for other statuses or when the payload was purged.
- Tenants only see their own invoices: another tenant's id returns `404`.

## Fiscal logic

| Regime | Category | VAT type used | Statement preset | Stamp duty |
| --- | --- | --- | --- | --- |
| FORFETTARIO | IT_PRIVATE, IT_BUSINESS | tenant VAT type | art. 1 c. 58 L. 190/2014 (regime forfettario) | €2 if amount > €77.47 |
| FORFETTARIO | EU_PRIVATE | tenant VAT type | art. 7-ter DPR 633/72, private EU customer | €2 if amount > €77.47 |
| FORFETTARIO | EXTRAEU_PRIVATE | tenant VAT type | art. 7-ter DPR 633/72, extra-EU customer | €2 if amount > €77.47 |
| ORDINARIO | IT_PRIVATE, IT_BUSINESS | tenant VAT type (e.g. 22%), `amountCents` is VAT-inclusive | none | no |
| ORDINARIO | EU_PRIVATE, EXTRAEU_PRIVATE | tenant non-taxable VAT type | art. 7-ter presets | no |

- Statements are printed on the invoice line and in the notes. Override them per category in the admin panel.
- The €2 stamp duty follows the tenant's **stamp duty mode** (admin panel → *Stamp duty*). It only applies to FORFETTARIO invoices whose `amountCents` is above €77.47:

  On e-invoices Fatture in Cloud does **not** add `stamp_duty` to the amount due: the field only declares
  that the (virtual) stamp was paid. Charging it to the customer therefore needs a separate invoice line.

  | Mode | Invoice lines | `stamp_duty` | Total / recorded payment | Example, `amountCents: 10000` |
  | --- | --- | --- | --- | --- |
  | `CHARGED_TO_CUSTOMER` (default) | `amountCents` + `BOLLO` "Rimborso imposta di bollo" €2 | €2 | `amountCents + 200` | lines €100 + €2, bollo €2 declared, paid €102 |
  | `INCLUDED` | `amountCents` | €2 | `amountCents` | line €100, bollo €2 declared, paid €100 |
  | `DISABLED` | `amountCents` | none | `amountCents` | line €100, paid €100 |

  - `CHARGED_TO_CUSTOMER`: the customer pays the €2 on top, as a second invoice line with the tenant's **stamp duty VAT type** (choose a VAT type excluded under art. 15 DPR 633/72 in the admin panel). Use it only if your checkout actually collects `amount + €2`. When the stamp applies and no stamp duty VAT type is set, the API returns `409 tenant_not_configured`.
  - `INCLUDED`: the seller bears the stamp. The customer pays exactly `amountCents` and the invoice total is `amountCents`; the €2 is declared on the invoice and paid by the seller to the tax authority. **Recommended for payment-processor flows with fixed prices** (Stripe Checkout, Paddle, app stores): the invoice total matches the charge exactly.
  - `DISABLED`: no stamp duty at all, for tenants that handle it elsewhere.

  In every mode the API response keeps your `amountCents` and reports `stampDutyCents` (0 or 200, the declared stamp). Check the choice with your accountant.
- `IT_BUSINESS` invoices are B2B: the customer's partita IVA, SDI recipient code (`0000000` + PEC when missing).
- Other invoices are B2C, with the SDI payment method from the tenant (`MP08`, payment card, by default).
- Country names are mapped from ISO codes to the Italian names Fatture in Cloud expects.

## Data and privacy

Your app is the data controller for its customers. This service receives customer billing data per request
and forwards it to Fatture in Cloud. It stores in its own database:

- the invoice record (amount, category, description, status, FIC ids, your `externalRef`);
- `requestPayload`: the customer data needed to retry a failed call. With `PURGE_PAYLOAD_ON_SUCCESS=true`
  (the default) it is deleted as soon as the invoice is ISSUED. FAILED and PENDING invoices keep it until they succeed.

The customer data then lives in Fatture in Cloud, as with any e-invoice.

## Operations notes

- **Token refresh.** Access tokens are refreshed when less than 5 minutes remain. The refresh runs inside a transaction holding `SELECT ... FOR UPDATE` on the tenant row, so concurrent requests never use the same (rotating) refresh token twice. If Fatture in Cloud rejects the refresh token, the tenant is flagged **reconnect required** in the admin panel and API calls return `409 fic_reconnect_required` until an admin reconnects.
- **Stuck PENDING rows.** A PENDING row older than a few minutes means the process stopped during the FIC call. Check Fatture in Cloud before doing anything: the document may exist.
- **Retries and duplicates.** Fatture in Cloud has no idempotency key. If a create call times out after FIC saved the document, a retry can create a second document. Check FIC before retrying invoices that failed with a timeout.
- **Rate limit** is in memory and per process.
- **SDI.** Creating an e-invoice in Fatture in Cloud does not transmit it. Enable *Send e-invoices to SDI automatically* per tenant, or send them from Fatture in Cloud.

## Development

```bash
npm ci
cp .env.example .env
docker compose up -d db
npx prisma migrate deploy
npm run dev

npm run lint && npm run typecheck && npm test && npm run build
```

Integration tests need a MySQL test database (see [CONTRIBUTING.md](CONTRIBUTING.md)). Tests never call the real
Fatture in Cloud API: `fetch` is stubbed with a fake FIC.

Stack: Next.js 16 (App Router), TypeScript, Prisma 6, MySQL 8, zod, Vitest.

## License

[MIT](LICENSE)
