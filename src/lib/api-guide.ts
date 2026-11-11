// The API integration guide shown at /admin/api and downloaded as Markdown.
// One source for both, so the page and the file never drift apart.

/** The guide in Markdown, with this instance's public URL filled in. */
export function apiGuideMarkdown(baseUrl: string): string {
  return `# fic-invoicing API integration guide

This guide explains how an app issues Italian electronic invoices through this fic-invoicing instance. It is written for developers and for coding agents. Everything an integration needs is here.

- **Base URL:** \`${baseUrl}/api/v1\`
- **Format:** JSON in and JSON out (\`Content-Type: application/json\`), except the PDF download.
- **Auth:** \`Authorization: Bearer <project API key>\`. Keys start with \`fici_\`.
- **Contract:** OpenAPI 3.1 in \`openapi.yaml\` in the repository.

## How it works

1. An admin creates a **project** for your app in this panel and gives you its **API key**. The key is shown once; keep it in your app's secrets (for example \`FICI_API_KEY\`), never in client-side code.
2. The project issues from a Fatture in Cloud company and inherits its settings (fiscal regime, VAT, payment account and method, numeration, stamp duty). An admin can customize any of them for your project. Several projects can share one company.
3. After each sale your **server** calls \`POST /api/v1/invoices\` with the amount and the customer's billing data. The service builds a correct e-invoice, creates it in Fatture in Cloud and, if the project is set up for it, sends it to SDI.
4. You store the returned invoice \`id\` next to your order, to read it later or to download the PDF.

New projects start in **dry run**. Invoices are validated against Fatture in Cloud but nothing is created there, so test freely until an admin turns dry run off.

## Integration checklist

- [ ] Keep the API key server-side only, in an environment variable.
- [ ] Use a stable **idempotency key** per sale, for example your order id. Reuse it on every retry of the same sale.
- [ ] Send amounts in **euro cents** as integers.
- [ ] Map each customer to a **category** and send the fields that category requires.
- [ ] Treat \`201\` and \`200\` as success, but always read \`status\` in the body.
- [ ] On \`502\` the invoice exists with \`status: "FAILED"\`; show or log \`error.message\` and retry later with the retry endpoint.
- [ ] Back off when you get \`429\` (read \`Retry-After\`).
- [ ] Store \`id\`, \`number\` and \`status\` with your order.

## Create an invoice

\`POST /api/v1/invoices\`

\`\`\`bash
curl -X POST ${baseUrl}/api/v1/invoices \\
  -H "Authorization: Bearer $FICI_API_KEY" \\
  -H "Content-Type: application/json" \\
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
\`\`\`

### Request body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| \`idempotencyKey\` | string, max 191 | yes | Unique per sale within the project. Repeating it returns the existing invoice. |
| \`externalRef\` | string, max 191 | no | Your own reference (order id, checkout id). |
| \`amountCents\` | integer ≥ 1 | yes | Price of the service in euro cents. For ordinario companies with Italian customers it includes VAT. |
| \`description\` | string, max 1000 | yes | Text of the invoice line. |
| \`customer\` | object | yes | See *Customers*. |
| \`paidAt\` | string | no | Payment and document date, \`YYYY-MM-DD\` or ISO date-time. Defaults to today in Europe/Rome. Cannot be in the future. |
| \`dryRun\` | boolean | no | \`true\` forces a dry run. \`false\` cannot turn off a project's dry run. |

### Customers

Every customer needs \`category\`, \`address\`, \`zipCode\`, \`city\`, \`countryCode\` (ISO 3166-1 alpha-2) and \`email\`.

| Category | Who | Also required |
| --- | --- | --- |
| \`IT_PRIVATE\` | Private customer in Italy | \`firstName\`, \`lastName\`, valid \`fiscalCode\`, \`countryCode: "IT"\`, 5-digit \`zipCode\`, \`province\` (for example \`RM\`) |
| \`EU_PRIVATE\` | Private customer in another EU country | \`firstName\`, \`lastName\`, EU \`countryCode\` other than \`IT\` |
| \`EXTRAEU_PRIVATE\` | Private customer outside the EU | \`firstName\`, \`lastName\`, non-EU \`countryCode\` |
| \`IT_BUSINESS\` | Italian company or freelancer (B2B) | \`companyName\`, valid Italian \`vatNumber\` (11 digits, optional \`IT\` prefix), \`sdiCode\` (7 characters) **or** \`pec\`, \`countryCode: "IT"\`, \`zipCode\`, \`province\` |

Optional fields: \`firstName\` and \`lastName\` (max 100 characters), \`companyName\` (max 200), \`address\` (max 200), \`city\` (max 100).

\`\`\`jsonc
// EU private customer
{ "category": "EU_PRIVATE", "firstName": "Anna", "lastName": "Schmidt", "address": "Hauptstr. 1",
  "zipCode": "10115", "city": "Berlin", "countryCode": "DE", "email": "anna@example.com" }

// Italian business: sdiCode, or pec when the customer has no recipient code
{ "category": "IT_BUSINESS", "companyName": "Example S.r.l.", "vatNumber": "12345678903",
  "sdiCode": "ABC1234", "address": "Via Milano 2", "zipCode": "20100", "city": "Milano",
  "province": "MI", "countryCode": "IT", "email": "billing@example.com" }
\`\`\`

### Response

\`201 Created\` when a new invoice is issued:

\`\`\`json
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
  "deletedAt": null,
  "createdAt": "2026-11-11T15:08:00.408Z",
  "updatedAt": "2026-11-11T15:08:00.462Z"
}
\`\`\`

| Field | Meaning |
| --- | --- |
| \`id\` | Invoice id in this service. Use it for every other endpoint. |
| \`status\` | \`PENDING\`, \`ISSUED\`, \`FAILED\` or \`DELETED\` (see *Statuses*). |
| \`number\` | Invoice number as printed, for example \`12/A\`. \`null\` for dry runs and failures. |
| \`ficDocumentId\` | Document id in Fatture in Cloud. \`null\` for dry runs and failures. |
| \`amountCents\` | The amount you sent, unchanged. |
| \`stampDutyCents\` | Stamp duty on the invoice: \`0\` or \`200\`. |
| \`dryRun\` | \`true\` when nothing was created in Fatture in Cloud. |
| \`errorMessage\` | Why the invoice failed, otherwise \`null\`. |
| \`attempts\` | How many times the service called Fatture in Cloud for it. |
| \`sdi.sentAt\` / \`sdi.error\` | When the e-invoice was sent to SDI, or why the automatic send failed. |
| \`deletedAt\` | Set when an admin deleted the invoice. |

### Response codes

| Code | Meaning | What to do |
| --- | --- | --- |
| \`201\` | Invoice issued (or dry run validated). | Store \`id\` and \`number\`. |
| \`200\` | An invoice with this \`idempotencyKey\` already exists. It is returned unchanged, whatever its status. | Read \`status\`. \`DELETED\` means it is no longer valid: use a new key to invoice again. |
| \`400\` | Body is not valid JSON (\`invalid_json\`). | Fix the request. |
| \`401\` | Missing or wrong API key (\`unauthorized\`). | Check the key. |
| \`403\` | Project disabled by an admin (\`forbidden\`). | Ask the admin. |
| \`409\` | Project not ready: \`fic_not_connected\`, \`fic_reconnect_required\` or \`tenant_not_configured\`. No invoice is created. | Ask the admin to finish the setup, then send again with the same key. |
| \`422\` | Validation failed (\`validation_error\`). \`error.details\` lists \`{ path, message }\`. | Fix the fields listed. |
| \`429\` | Rate limit for this key (\`rate_limited\`). | Wait for \`Retry-After\` seconds. |
| \`502\` | Fatture in Cloud refused the invoice, or the totals check failed. The invoice is stored as \`FAILED\`; the body is the invoice plus \`error\`. | Log \`error.message\`; retry later with the retry endpoint. |

## Other endpoints

| Method and path | What it does |
| --- | --- |
| \`GET /api/v1/invoices/{id}\` | Returns the invoice. Another project's id returns \`404\`. |
| \`GET /api/v1/invoices/{id}/pdf\` | Streams the courtesy PDF (\`application/pdf\`). \`409\` for dry runs, failed or deleted invoices. |
| \`POST /api/v1/invoices/{id}/retry\` | Issues a \`FAILED\` invoice again with the project's current settings, or resends to SDI an issued invoice whose automatic send failed. \`409\` for other statuses, deleted invoices, or when the stored data was purged. \`502\` if it still fails. |
| \`GET /api/v1/health\` | No auth. \`{"status":"ok","database":"ok"}\`, or \`503\` when the database is unreachable. |

\`\`\`bash
curl -H "Authorization: Bearer $FICI_API_KEY" ${baseUrl}/api/v1/invoices/$ID
curl -H "Authorization: Bearer $FICI_API_KEY" -o invoice.pdf ${baseUrl}/api/v1/invoices/$ID/pdf
curl -X POST -H "Authorization: Bearer $FICI_API_KEY" ${baseUrl}/api/v1/invoices/$ID/retry
curl ${baseUrl}/api/v1/health
\`\`\`

## Errors

Every error has the same shape:

\`\`\`json
{ "error": { "code": "validation_error", "message": "Invalid request body", "details": [{ "path": "customer.fiscalCode", "message": "Invalid fiscal code" }] } }
\`\`\`

Codes: \`unauthorized\`, \`forbidden\`, \`not_found\`, \`invalid_json\`, \`validation_error\`, \`conflict\`, \`tenant_not_configured\`, \`fic_not_connected\`, \`fic_reconnect_required\`, \`fic_error\`, \`rate_limited\`, \`internal_error\`. \`tenant_not_configured\` keeps its historical name: projects used to be called tenants.

## Statuses

| Status | Meaning |
| --- | --- |
| \`PENDING\` | The request is being processed. It should not stay in this state. |
| \`ISSUED\` | Created in Fatture in Cloud with a number. With \`dryRun: true\` it was only validated: there is no number and no document. |
| \`FAILED\` | Fatture in Cloud refused it or could not be reached. No number was used. It can be retried. |
| \`DELETED\` | An admin deleted it before it was sent to SDI. It is not a valid invoice. |

## Behaviour to rely on

- **Idempotency.** For each project, an \`idempotencyKey\` is used once. Repeating it never calls Fatture in Cloud twice and returns the stored invoice with \`200\`, in whatever state it is: a \`FAILED\` invoice stays failed (use retry) and a \`DELETED\` one stays deleted (use a new key).
- **Totals pre-check.** Before creating a document, Fatture in Cloud computes the invoice totals. If the payment does not match the amount due, the invoice fails and no number is used.
- **Dry run.** Only the totals check runs, so nothing is created in Fatture in Cloud or sent to SDI. A passing dry run is \`ISSUED\` with \`dryRun: true\`, \`number: null\` and \`ficDocumentId: null\`.
- **Stamp duty.** €2 applies to forfettario invoices above €77.47, depending on the project's stamp duty mode:
  - *charged to customer*: an extra €2 line, so the customer pays \`amountCents\` + 200;
  - *included*: the seller bears it and the customer pays \`amountCents\`;
  - *disabled*: never applied.

  \`stampDutyCents\` reports it either way.
- **Rate limit.** Requests per minute per API key are limited (60 by default). Over the limit you get \`429\` with \`Retry-After\`.
- **Personal data.** After an invoice is issued the stored customer data is deleted by default.

## Not tax advice

The fiscal statements, stamp duty rule and VAT handling are common setups for Italian sole traders. Check the project's settings with an accountant before sending real invoices.
`;
}
