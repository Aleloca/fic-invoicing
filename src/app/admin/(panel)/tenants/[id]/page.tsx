import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConnectionMark } from "@/components/badges";
import { ArrowLeft, ArrowRight } from "@/components/icons";
import { Notice, Notices } from "@/components/notices";
import { SetupLine, missingConfiguration, setupProgress } from "@/components/setup-line";
import { listPaymentAccounts, listPaymentMethods, listVatTypes } from "@/lib/fic/client";
import { getFicAccess } from "@/lib/fic/tokens";
import { parseStatementOverrides, presetStatement } from "@/lib/fiscal/statements";
import { CUSTOMER_CATEGORIES } from "@/lib/fiscal/types";
import { CATEGORY_LABELS, dateOnly, dateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { disconnectFicAction, startFicConnectAction, updateTenantConfigAction } from "../../../actions";
import { RotateKeyForm } from "./rotate-key-form";

export const metadata: Metadata = { title: "Tenant" };


interface Option {
  id: number;
  label: string;
}

interface Lookups {
  vatTypes: Option[] | null;
  paymentAccounts: Option[] | null;
  paymentMethods: Option[] | null;
  error: string | null;
}

async function loadLookups(tenantId: string, ready: boolean): Promise<Lookups> {
  const empty: Lookups = { vatTypes: null, paymentAccounts: null, paymentMethods: null, error: null };
  if (!ready) return empty;
  try {
    const access = await getFicAccess(tenantId);
    if (!access.companyId) return empty;
    const [vatTypes, accounts, methods] = await Promise.all([
      listVatTypes(access.accessToken, access.companyId),
      listPaymentAccounts(access.accessToken, access.companyId),
      listPaymentMethods(access.accessToken, access.companyId),
    ]);
    return {
      vatTypes: vatTypes
        .filter((v) => !v.is_disabled)
        .map((v) => ({ id: v.id, label: `${v.value}% – ${v.description}${v.ei_type ? ` (${v.ei_type})` : ""}` })),
      paymentAccounts: accounts.map((a) => ({ id: a.id, label: a.name })),
      paymentMethods: methods.map((m) => ({ id: m.id, label: `${m.name}${m.is_default ? " (default)" : ""}` })),
      error: null,
    };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : "Could not load Fatture in Cloud settings" };
  }
}

function IdField({
  name,
  label,
  hint,
  value,
  options,
}: {
  name: string;
  label: string;
  hint?: React.ReactNode;
  value: number | null;
  options: Option[] | null;
}) {
  const known = options?.some((o) => o.id === value);
  const hintId = hint ? `${name}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      {options ? (
        <select id={name} name={name} defaultValue={value ?? ""} aria-describedby={hintId}>
          <option value="">Not set</option>
          {value !== null && !known && <option value={value}>#{value} (not found in Fatture in Cloud)</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={name}
          name={name}
          type="number"
          min={1}
          defaultValue={value ?? ""}
          placeholder="Fatture in Cloud id"
          aria-describedby={hintId}
        />
      )}
      {hint && (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      )}
    </div>
  );
}

function SectionHead({
  step,
  done,
  title,
  children,
}: {
  step?: number;
  done?: boolean;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="section-head">
      {step !== undefined && (
        <span className={`step${done ? " done" : ""}`} aria-hidden="true">
          {step}
        </span>
      )}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

export default async function TenantPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { id } = await params;
  const { notice, error } = await searchParams;
  const tenant = await prisma.tenant.findUnique({ where: { id } });
  if (!tenant) notFound();

  const connected = Boolean(tenant.accessTokenEnc) && !tenant.ficNeedsReconnect;
  const lookups = await loadLookups(tenant.id, connected && tenant.ficCompanyId !== null);
  const overrides = parseStatementOverrides(tenant.fiscalStatements) ?? {};
  const progress = setupProgress(tenant);
  const missing = missingConfiguration(tenant);
  const hasCompany = connected && tenant.ficCompanyId !== null;

  return (
    <>
      <Link href="/admin" className="crumb">
        <ArrowLeft />
        Tenants
      </Link>
      <div className="page-head">
        <h1>{tenant.name}</h1>
        <div className="actions">
          <Link className="btn secondary" href={`/admin/tenants/${tenant.id}/invoices`}>
            Invoices
            <ArrowRight />
          </Link>
        </div>
      </div>
      <Notices notice={notice} error={error} />

      <div style={{ marginBottom: 28 }}>
        <SetupLine progress={progress} big />
      </div>

      <dl className="facts" style={{ marginBottom: 40 }}>
        <div>
          <dt>Slug</dt>
          <dd>
            <code>{tenant.slug}</code>
          </dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>
            {tenant.dryRun ? <span className="mark dry">Dry run</span> : <span className="mark live">Live</span>}
          </dd>
        </div>
        <div>
          <dt>API key</dt>
          <dd>
            {tenant.active ? "Accepted" : "Refused (tenant disabled)"}, starts with <code>{tenant.apiKeyPrefix}…</code>
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{dateOnly(tenant.createdAt)}</dd>
        </div>
      </dl>

      <section className="section" id="connection" aria-labelledby="connection-title">
        <SectionHead step={1} done={hasCompany} title="Fatture in Cloud">
          Authorize with the Fatture in Cloud user that owns the company, then choose the company.
        </SectionHead>
        <div className="section-body">
          <dl className="facts">
            <div>
              <dt id="connection-title">Company</dt>
              <dd>
                <ConnectionMark tenant={tenant} />
              </dd>
            </div>
            {tenant.connectedAt && (
              <div>
                <dt>Connected</dt>
                <dd>{dateTime(tenant.connectedAt)}</dd>
              </div>
            )}
            {tenant.tokenExpiresAt && connected && (
              <div>
                <dt>Access token renews</dt>
                <dd>{dateTime(tenant.tokenExpiresAt)}</dd>
              </div>
            )}
          </dl>
          {tenant.ficLastError && (
            <Notice tone="error" className="inline">
              {tenant.ficLastError}
            </Notice>
          )}
          <div className="btn-row">
            <form action={startFicConnectAction.bind(null, tenant.id)}>
              <button type="submit" className={`btn${tenant.accessTokenEnc && !tenant.ficNeedsReconnect ? " secondary" : ""}`}>
                {tenant.accessTokenEnc ? "Reconnect" : "Connect Fatture in Cloud"}
              </button>
            </form>
            {connected && (
              <Link className={`btn${tenant.ficCompanyId === null ? "" : " secondary"}`} href={`/admin/tenants/${tenant.id}/company`}>
                {tenant.ficCompanyId === null ? "Choose the company" : "Change company"}
              </Link>
            )}
            {tenant.accessTokenEnc && (
              <form action={disconnectFicAction.bind(null, tenant.id)}>
                <button type="submit" className="btn danger">
                  Disconnect
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      <form action={updateTenantConfigAction.bind(null, tenant.id)}>
        <section className="section" id="configuration">
          <SectionHead step={2} done={missing.length === 0} title="Invoice settings">
            {lookups.vatTypes
              ? "Values come from the connected Fatture in Cloud company."
              : "Connect a company to pick these values from lists instead of typing ids."}
          </SectionHead>
          <div className="section-body">
            {lookups.error && (
              <Notice tone="error" className="inline">
                Could not load the lists from Fatture in Cloud: {lookups.error}
              </Notice>
            )}
            {missing.length > 0 && (
              <Notice tone="warn" className="inline">
                <strong>Still missing:</strong> {missing.join(", ")}.
                {missing.includes("stamp duty VAT type") &&
                  " Invoices above €77.47 are refused (tenant_not_configured) until you pick one."}
              </Notice>
            )}
            <div className="fields">
              <div className="field">
                <label htmlFor="name">Name</label>
                <input id="name" name="name" type="text" defaultValue={tenant.name} required maxLength={100} />
              </div>
              <div className="field">
                <label htmlFor="fiscalRegime">Fiscal regime</label>
                <select id="fiscalRegime" name="fiscalRegime" defaultValue={tenant.fiscalRegime}>
                  <option value="FORFETTARIO">Forfettario</option>
                  <option value="ORDINARIO">Ordinario</option>
                </select>
              </div>
              <IdField
                name="vatTypeId"
                label="VAT type"
                hint="Forfettario: used for every invoice. Ordinario: used for Italian customers."
                value={tenant.vatTypeId}
                options={lookups.vatTypes}
              />
              <IdField
                name="nonTaxableVatTypeId"
                label="Non-taxable VAT type"
                hint="Ordinario only: EU and extra-EU private customers (art. 7-ter)."
                value={tenant.nonTaxableVatTypeId}
                options={lookups.vatTypes}
              />
              <IdField
                name="paymentAccountId"
                label="Payment account"
                value={tenant.paymentAccountId}
                options={lookups.paymentAccounts}
              />
              <IdField
                name="paymentMethodId"
                label="Payment method"
                value={tenant.paymentMethodId}
                options={lookups.paymentMethods}
              />
              <div className="field">
                <label htmlFor="numeration">Numeration</label>
                <input
                  id="numeration"
                  name="numeration"
                  type="text"
                  defaultValue={tenant.numeration ?? ""}
                  maxLength={20}
                  placeholder="/A"
                  aria-describedby="numeration-hint"
                />
                <span className="hint" id="numeration-hint">
                  For example /A. Empty uses the company&apos;s default numeration.
                </span>
              </div>
              <div className="field">
                <label htmlFor="itemCode">Item code</label>
                <input
                  id="itemCode"
                  name="itemCode"
                  type="text"
                  defaultValue={tenant.itemCode ?? ""}
                  maxLength={50}
                  aria-describedby="itemCode-hint"
                />
                <span className="hint" id="itemCode-hint">
                  Printed on the invoice line. Optional.
                </span>
              </div>
              <div className="field">
                <label htmlFor="eiPaymentMethod">SDI payment method</label>
                <input
                  id="eiPaymentMethod"
                  name="eiPaymentMethod"
                  type="text"
                  defaultValue={tenant.eiPaymentMethod}
                  pattern="MP[0-9]{2}"
                  required
                  aria-describedby="eiPaymentMethod-hint"
                />
                <span className="hint" id="eiPaymentMethod-hint">
                  ModalitaPagamento code. MP08 is payment card.
                </span>
              </div>
              <div className="field">
                <label htmlFor="stampDutyMode">Stamp duty (bollo)</label>
                <select
                  id="stampDutyMode"
                  name="stampDutyMode"
                  defaultValue={tenant.stampDutyMode}
                  aria-describedby="stampDutyMode-hint"
                >
                  <option value="CHARGED_TO_CUSTOMER">Charged to customer (amount + €2 line)</option>
                  <option value="INCLUDED">Included, borne by you (customer pays amount)</option>
                  <option value="DISABLED">Disabled</option>
                </select>
                <span className="hint" id="stampDutyMode-hint">
                  €2 on forfettario invoices above €77.47. <em>Charged to customer</em>: a separate €2 &ldquo;Rimborso
                  imposta di bollo&rdquo; line, the customer pays amount + €2. <em>Included</em>: you bear the €2, the
                  customer pays exactly the amount (fixed checkout prices). <em>Disabled</em>: never applied.
                </span>
              </div>
              <IdField
                name="stampDutyVatTypeId"
                label="Stamp duty VAT type"
                hint="Charged to customer only: VAT type of the €2 bollo line, excluded under art. 15 DPR 633/72."
                value={tenant.stampDutyVatTypeId}
                options={lookups.vatTypes}
              />
            </div>

            <h3 className="subhead">Fiscal statements</h3>
            <p className="hint" style={{ marginTop: -8 }}>
              Leave a field empty to use the preset shown in it for the current regime. Not tax advice: check the wording
              with your accountant.
            </p>
            <div className="fields">
              {CUSTOMER_CATEGORIES.map((category) => (
                <div className="field" key={category}>
                  <label htmlFor={`statement_${category}`}>
                    {CATEGORY_LABELS[category]} <code className="hint">{category}</code>
                  </label>
                  <textarea
                    id={`statement_${category}`}
                    name={`statement_${category}`}
                    defaultValue={overrides[category] ?? ""}
                    placeholder={presetStatement(tenant.fiscalRegime, category) ?? "(no statement)"}
                    maxLength={2000}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="going-live">
          <SectionHead step={3} done={progress.live} title="Going live">
            Keep dry run on until a test invoice looks right to you and your accountant.
          </SectionHead>
          <div className="section-body">
            <div className="toggles">
              <label className="toggle">
                <input type="checkbox" name="dryRun" defaultChecked={tenant.dryRun} />
                <strong>Dry run</strong>
                <span className="hint">
                  Every invoice is validated with Fatture in Cloud&apos;s totals endpoint and nothing is created there.
                </span>
              </label>
              <label className="toggle">
                <input type="checkbox" name="sendToSdi" defaultChecked={tenant.sendToSdi} />
                <strong>Send to SDI automatically</strong>
                <span className="hint">After a real invoice is created, ask Fatture in Cloud to transmit it to SDI.</span>
              </label>
              <label className="toggle">
                <input type="checkbox" name="active" defaultChecked={tenant.active} />
                <strong>Tenant active</strong>
                <span className="hint">When off, the API key is refused and the app cannot issue invoices.</span>
              </label>
            </div>
            <div className="form-foot">
              <button type="submit" className="btn">
                Save settings
              </button>
              <span className="hint">Saves sections 2 and 3 together.</span>
            </div>
          </div>
        </section>
      </form>

      <section className="section" id="api-key">
        <SectionHead title="API key">
          Your app sends it as <code>Authorization: Bearer</code>. Rotating it stops the current key at once.
        </SectionHead>
        <div className="section-body">
          <RotateKeyForm tenantId={tenant.id} prefix={tenant.apiKeyPrefix} />
        </div>
      </section>
    </>
  );
}
