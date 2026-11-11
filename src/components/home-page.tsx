import Link from "next/link";
import { Logo } from "@/components/brand";
import { CopyButton } from "@/components/copy-button";
import { ArrowRight, External } from "@/components/icons";

const REPO = "https://github.com/Aleloca/fic-invoicing";

const STOPS: { title: string; text?: string; command?: string; shown?: string }[] = [
  { title: "Clone", command: `git clone ${REPO}.git`, shown: "git clone …/fic\u2011invoicing.git", text: "Then copy .env.example to .env and fill in the secrets." },
  { title: "Start", command: "docker compose up -d --build", text: "MySQL, migrations and the app on port 3000." },
  { title: "Create a project", text: "One per app, in the admin. Copy its API key: it is shown once." },
  { title: "Connect", text: "Authorize Fatture in Cloud, choose the company, set its VAT, payment and numeration." },
  { title: "Dry run", text: "Invoices are validated against Fatture in Cloud's totals. Nothing is created." },
  { title: "Live", command: "POST /api/v1/invoices", text: "Untick dry run. Every sale becomes an e-invoice." },
];

const HANDLES: { title: string; items: React.ReactNode[] }[] = [
  {
    title: "Customers",
    items: [
      <>
        Private customers in Italy, in the EU and outside the EU (<code>IT_PRIVATE</code>, <code>EU_PRIVATE</code>,{" "}
        <code>EXTRAEU_PRIVATE</code>).
      </>,
      <>
        Italian businesses (<code>IT_BUSINESS</code>) with SDI code or PEC.
      </>,
      <>Country names and B2C or B2B routing set for you.</>,
    ],
  },
  {
    title: "Fiscal rules",
    items: [
      <>Forfettario and ordinario regimes.</>,
      <>Preset statements (art. 1 c. 58 L. 190/2014, art. 7-ter DPR 633/72), overridable per company, project and category.</>,
      <>€2 stamp duty above €77.47: charged to the customer, borne by you, or disabled.</>,
    ],
  },
  {
    title: "Safety",
    items: [
      <>Dry run per project, on by default.</>,
      <>Every real invoice is pre-checked against the totals endpoint, so a mismatch fails before a number is used.</>,
      <>
        Idempotent creation with <code>idempotencyKey</code>; failed invoices can be retried.
      </>,
    ],
  },
  {
    title: "Operations",
    items: [
      <>Several Fatture in Cloud accounts and companies; projects on one company share its settings.</>,
      <>OAuth tokens encrypted at rest, refresh serialized per account.</>,
      <>Optional automatic sending to SDI; courtesy PDF download.</>,
      <>Customer personal data dropped after success (configurable).</>,
    ],
  },
];

const REQUEST = `curl -X POST https://invoices.example.com/api/v1/invoices \\
  -H "Authorization: Bearer $FICI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "idempotencyKey": "order-1001",
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
      "countryCode": "IT"
    }
  }'`;

const RESPONSE = `{
  "id": "cmexample0001",
  "idempotencyKey": "order-1001",
  "status": "ISSUED",
  "customerCategory": "IT_PRIVATE",
  "number": "1/A",
  "ficDocumentId": 123456789,
  "amountCents": 10000,
  "stampDutyCents": 200,
  "dryRun": false,
  "attempts": 1,
  "sdi": { "sentAt": null, "error": null }
}`;

/**
 * The public home page. `admin` adds the links to this instance's admin panel; the copy
 * published on GitHub Pages has no admin, so it leaves them out.
 */
export function HomePage({ admin }: { admin: boolean }) {
  return (
    <div className="home">
      <header className="home-bar">
        <Link href="/" className="home-brand" aria-label="fic-invoicing, home">
          <Logo height={30} />
        </Link>
        <nav aria-label="Page">
          <a href="#why">Why</a>
          <a href="#handles" className="optional">
            What it handles
          </a>
          <a href="#api">API</a>
          <a href={REPO}>GitHub</a>
          {admin && (
            <Link href="/admin" className="home-admin">
              Admin
              <ArrowRight />
            </Link>
          )}
        </nav>
      </header>

      <main>
        <section className="home-hero" aria-labelledby="hero-title">
          <div className="home-hero-text">
            <h1 id="hero-title" className="home-title">
              fic-<span>invoicing</span>
            </h1>
            <p className="home-lead">
              Italian electronic invoices through Fatture in Cloud, for several apps at once. Self-hosted, open source,
              MIT licensed.
            </p>
          </div>
          <div className="home-actions">
            <a className="btn home-red" href={REPO}>
              View on GitHub
              <External />
            </a>
            {admin && (
              <Link className="btn secondary" href="/admin">
                Open admin
              </Link>
            )}
          </div>
        </section>

        <section aria-labelledby="quickstart-title" className="home-line-wrap">
          <h2 id="quickstart-title" className="visually-hidden">
            Quickstart
          </h2>
          <ol className="home-line">
            {STOPS.map((s, i) => (
              <li key={s.title} className={`home-stop${i === STOPS.length - 1 ? " end" : ""}`}>
                <span className="home-dot" aria-hidden="true" />
                <span className="home-stop-n">{String(i + 1).padStart(2, "0")}</span>
                <h3>{s.title}</h3>
                {s.command && (
                  <span className="home-cmd">
                    <code title={s.command}>{s.shown ?? s.command}</code>
                    {!s.command.startsWith("POST") && <CopyButton text={s.command} />}
                  </span>
                )}
                {s.text && <p>{s.text}</p>}
              </li>
            ))}
          </ol>
        </section>

        <section id="why" className="home-section" aria-labelledby="why-title">
          <h2 id="why-title">Why</h2>
          <div className="home-prose">
            <p className="home-statement">
              Selling online from Italy means an e-invoice for every sale, often to private customers abroad.
            </p>
            <p>
              Wiring Fatture in Cloud into every project means reimplementing OAuth with rotating refresh tokens, fiscal
              wording, country mapping, retries and idempotency each time. This service does it once.
            </p>
            <p>
              Each app is a <strong>project</strong> with its own API key. Projects issue from a Fatture in Cloud company
              and inherit its settings, so several apps can invoice from one company without setting it up twice. Your
              app sends the customer&apos;s billing data; the service builds a correct e-invoice payload, calls Fatture in
              Cloud and keeps an idempotent record of what happened. One OAuth app serves the whole instance.
            </p>
          </div>
        </section>

        <section id="handles" className="home-section" aria-labelledby="handles-title">
          <h2 id="handles-title">What it handles</h2>
          <div className="home-handles">
            {HANDLES.map((h) => (
              <div key={h.title} className="home-handle">
                <h3>{h.title}</h3>
                <ul>
                  {h.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section id="api" className="home-section" aria-labelledby="api-title">
          <h2 id="api-title">API</h2>
          <div className="home-prose">
            <p>
              Base path <code>/api/v1</code>, authenticated with <code>Authorization: Bearer</code> and the
              project&apos;s API key. The full contract is{" "}
              <a href={`${REPO}/blob/main/openapi.yaml`}>openapi.yaml</a>.
            </p>
          </div>
          <div className="home-code">
            <figure>
              <figcaption>Request</figcaption>
              <pre>
                <code>{REQUEST}</code>
              </pre>
            </figure>
            <figure>
              <figcaption>
                Response <span>201 Created</span>
              </figcaption>
              <pre>
                <code>{RESPONSE}</code>
              </pre>
            </figure>
          </div>
        </section>

        <section className="home-limit" aria-labelledby="limit-title">
          <h2 id="limit-title">Not tax advice.</h2>
          <p>
            The fiscal statements, the stamp duty rule and the VAT handling are common setups for Italian sole traders.
            Your situation may differ. Verify every statement and setting with your accountant before you send real
            invoices, and keep projects in dry run until then.
          </p>
        </section>
      </main>

      <footer className="home-foot">
        <span>fic-invoicing · MIT license · not affiliated with Fatture in Cloud</span>
        <nav aria-label="Project">
          <a href={REPO}>Source</a>
          <a href={`${REPO}#readme`}>README</a>
          <a href={`${REPO}/blob/main/docs/deploy-pm2.md`}>Deploy with pm2</a>
          <a href={`${REPO}/blob/main/CONTRIBUTING.md`}>Contributing</a>
        </nav>
      </footer>
    </div>
  );
}
