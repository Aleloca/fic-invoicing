import Link from "next/link";
import { notFound } from "next/navigation";
import { ConnectionBadge } from "@/components/badges";
import { Notices } from "@/components/notices";
import { listPaymentAccounts, listPaymentMethods, listVatTypes } from "@/lib/fic/client";
import { getFicAccess } from "@/lib/fic/tokens";
import { parseStatementOverrides, presetStatement } from "@/lib/fiscal/statements";
import { CUSTOMER_CATEGORIES } from "@/lib/fiscal/types";
import { prisma } from "@/lib/prisma";
import { disconnectFicAction, startFicConnectAction, updateTenantConfigAction } from "../../../actions";
import { RotateKeyForm } from "./rotate-key-form";

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
  hint?: string;
  value: number | null;
  options: Option[] | null;
}) {
  const known = options?.some((o) => o.id === value);
  return (
    <div>
      <label htmlFor={name}>
        {label}
        {hint && <span className="hint">{hint}</span>}
      </label>
      {options ? (
        <select id={name} name={name} defaultValue={value ?? ""}>
          <option value="">— not set —</option>
          {value !== null && !known && <option value={value}>#{value} (not found in FIC)</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input id={name} name={name} type="number" min={1} defaultValue={value ?? ""} placeholder="FIC id" />
      )}
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

  return (
    <>
      <div className="row spread">
        <h1>{tenant.name}</h1>
        <Link className="button secondary" href={`/admin/tenants/${tenant.id}/invoices`}>
          Invoices
        </Link>
      </div>
      <Notices notice={notice} error={error} />

      <section className="card">
        <h2>Fatture in Cloud connection</h2>
        <p>
          <ConnectionBadge tenant={tenant} />
          {tenant.tokenExpiresAt && connected && (
            <span className="muted small"> · access token expires {tenant.tokenExpiresAt.toISOString()}</span>
          )}
        </p>
        {tenant.ficLastError && <p className="notice error small">{tenant.ficLastError}</p>}
        <div className="row">
          <form action={startFicConnectAction.bind(null, tenant.id)}>
            <button type="submit">{tenant.accessTokenEnc ? "Reconnect" : "Connect Fatture in Cloud"}</button>
          </form>
          {connected && (
            <Link className="button secondary" href={`/admin/tenants/${tenant.id}/company`}>
              Change company
            </Link>
          )}
          {tenant.accessTokenEnc && (
            <form action={disconnectFicAction.bind(null, tenant.id)}>
              <button type="submit" className="danger">
                Disconnect
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Invoice configuration</h2>
        {lookups.error && <p className="notice error small">Could not load FIC lookups: {lookups.error}</p>}
        {!lookups.vatTypes && !lookups.error && (
          <p className="muted small">Connect a company to pick these values from dropdowns.</p>
        )}
        <form action={updateTenantConfigAction.bind(null, tenant.id)}>
          <div className="grid">
            <div>
              <label htmlFor="name">Name</label>
              <input id="name" name="name" type="text" defaultValue={tenant.name} required maxLength={100} />
            </div>
            <div>
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
              label="Non-taxable VAT type (ordinario)"
              hint="Ordinario only: EU / extra-EU private customers (art. 7-ter)."
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
            <div>
              <label htmlFor="numeration">
                Numeration <span className="hint">For example /A. Empty uses the FIC default numeration.</span>
              </label>
              <input id="numeration" name="numeration" type="text" defaultValue={tenant.numeration ?? ""} maxLength={20} />
            </div>
            <div>
              <label htmlFor="itemCode">
                Item code <span className="hint">Printed on the invoice line. Optional.</span>
              </label>
              <input id="itemCode" name="itemCode" type="text" defaultValue={tenant.itemCode ?? ""} maxLength={50} />
            </div>
            <div>
              <label htmlFor="eiPaymentMethod">
                SDI payment method <span className="hint">ModalitaPagamento code. MP08 = payment card.</span>
              </label>
              <input
                id="eiPaymentMethod"
                name="eiPaymentMethod"
                type="text"
                defaultValue={tenant.eiPaymentMethod}
                pattern="MP[0-9]{2}"
                required
              />
            </div>
          </div>

          <h2 style={{ marginTop: 24 }}>Options</h2>
          <label className="inline">
            <input type="checkbox" name="dryRun" defaultChecked={tenant.dryRun} /> Dry run (FIC validates invoices
            but does not save them)
          </label>
          <label className="inline">
            <input type="checkbox" name="applyStampDuty" defaultChecked={tenant.applyStampDuty} /> Apply €2 stamp
            duty on forfettario invoices above €77.47
          </label>
          <label className="inline">
            <input type="checkbox" name="sendToSdi" defaultChecked={tenant.sendToSdi} /> Send e-invoices to SDI
            automatically after creation
          </label>
          <label className="inline">
            <input type="checkbox" name="active" defaultChecked={tenant.active} /> Tenant active (API key accepted)
          </label>

          <h2 style={{ marginTop: 24 }}>Fiscal statements</h2>
          <p className="muted small">
            Leave empty to use the preset shown as placeholder for the current regime. Not tax advice: verify the
            wording with your accountant.
          </p>
          <div className="grid">
            {CUSTOMER_CATEGORIES.map((category) => (
              <div key={category}>
                <label htmlFor={`statement_${category}`}>{category}</label>
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
          <p>
            <button type="submit">Save configuration</button>
          </p>
        </form>
      </section>

      <section className="card">
        <h2>API key</h2>
        <RotateKeyForm tenantId={tenant.id} prefix={tenant.apiKeyPrefix} />
      </section>
    </>
  );
}
