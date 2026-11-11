import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusMark } from "@/components/badges";
import { ArrowLeft, ArrowRight } from "@/components/icons";
import { Notice, Notices } from "@/components/notices";
import { SectionHead } from "@/components/section-head";
import { isoDay, labelEn, lastEndedPeriod, nextCode, periodFromCode, previousCode } from "@/lib/appstore/calendar";
import type { EcbRates } from "@/lib/appstore/ecb";
import { APPLE_DISTRIBUTION_INTERNATIONAL, appStoreDescription, parseCustomer } from "@/lib/appstore/payload";
import type { ReportLine } from "@/lib/appstore/report";
import { todayInItaly } from "@/lib/fiscal/payload";
import { dateOnly, dateTime, euros } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { connectionState, PROJECT_INCLUDE, resolveConfig } from "@/lib/projects/config";
import { loadLookups, type Option } from "@/lib/projects/lookups";
import {
  checkAppStoreAction,
  issueAppStoreInvoiceAction,
  removeAppStoreAction,
  saveAppStoreAction,
  setAppStoreReportDismissedAction,
} from "../../../../actions";

export const metadata: Metadata = { title: "App Store" };

const periodRange = (code: string) => {
  const p = periodFromCode(code);
  return `${dateOnly(p.start)} – ${dateOnly(p.end)}`;
};

function IdSelect({ name, label, value, options, hint }: { name: string; label: string; value: number | null; options: Option[] | null; hint?: string }) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      {options ? (
        <select id={name} name={name} defaultValue={value ?? ""}>
          <option value="">Not set</option>
          {value !== null && !options.some((o) => o.id === value) && <option value={value}>#{value} (not found)</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input id={name} name={name} type="number" min={1} defaultValue={value ?? ""} placeholder="Fatture in Cloud id" />
      )}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export default async function AppStorePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { id } = await params;
  const { notice, error } = await searchParams;
  const project = await prisma.project.findUnique({ where: { id }, include: PROJECT_INCLUDE });
  if (!project) notFound();

  const account = await prisma.appStoreAccount.findUnique({
    where: { projectId: project.id },
    include: {
      reports: {
        orderBy: { period: "desc" },
        include: { invoice: { select: { id: true, status: true, ficNumber: true, amountCents: true, errorMessage: true, dryRun: true } } },
      },
    },
  });
  const lookups = await loadLookups(connectionState(project) === "ready" ? project.company : null);
  const config = resolveConfig(project.company, project).invoice;
  const customer = account ? parseCustomer(account.customer) : APPLE_DISTRIBUTION_INTERNATIONAL;
  const today = todayInItaly();

  const reports = account?.reports ?? [];
  const open = reports.filter((r) => r.status === "READY");
  const done = reports.filter((r) => r.status !== "READY");

  // Choices for the first period to invoice: the last 12 ended periods and the current one.
  const periodChoices: string[] = [];
  for (let code = nextCode(lastEndedPeriod().code), i = 0; i < 13; i += 1, code = previousCode(code)) periodChoices.push(code);

  return (
    <>
      <Link href={`/admin/projects/${project.id}`} className="crumb">
        <ArrowLeft />
        {project.name}
      </Link>
      <div className="page-head">
        <h1>App Store</h1>
        {account && (
          <div className="actions">
            <form action={checkAppStoreAction.bind(null, project.id)}>
              <button type="submit" className="btn secondary">
                Check now
              </button>
            </form>
          </div>
        )}
        <p className="sub">
          For an app paid through Apple. When Apple publishes the financial report of a fiscal month, it shows up here
          with the euro amount estimated at the ECB rate of that day. Check it against the Payments page of App Store
          Connect, then issue the invoice to Apple.
        </p>
      </div>
      <Notices notice={notice} error={error} />

      {account && (
        <>
          <dl className="facts" style={{ marginBottom: 40 }}>
            <div>
              <dt>Next report expected</dt>
              <dd>
                {labelEn(periodFromCode(account.nextPeriod))}{" "}
                <span className="hint">({periodRange(account.nextPeriod)})</span>
              </dd>
            </div>
            <div>
              <dt>Last check</dt>
              <dd>{account.lastCheckedAt ? dateTime(account.lastCheckedAt) : "Not yet"}</dd>
            </div>
            <div>
              <dt>Vendor</dt>
              <dd>
                <code>{account.vendorNumber}</code>
              </dd>
            </div>
          </dl>
          {account.lastError && (
            <Notice tone="error" className="inline">
              Last check failed: {account.lastError}
            </Notice>
          )}

          <section className="section" id="reports">
            <SectionHead title="To invoice">
              Reports waiting for an invoice. The service checks every 6 hours.
            </SectionHead>
            <div className="section-body">
              {open.length === 0 ? (
                <p className="hint">Nothing to invoice. The next report is {labelEn(periodFromCode(account.nextPeriod))}.</p>
              ) : (
                open.map((r) => {
                  const lines = r.lines as unknown as ReportLine[];
                  const ecb = r.ecbRates as unknown as EcbRates | null;
                  const failed = r.invoice?.status === "FAILED";
                  return (
                    <article key={r.id} className="report-card">
                      <header className="report-head">
                        <h3>{labelEn(periodFromCode(r.period))}</h3>
                        <span className="hint">
                          {periodRange(r.period)} · found {dateOnly(r.detectedAt)}
                        </span>
                      </header>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th scope="col">Currency</th>
                              <th scope="col">Countries</th>
                              <th scope="col" className="amount">
                                Units
                              </th>
                              <th scope="col" className="amount">
                                Proceeds
                              </th>
                              <th scope="col" className="amount">
                                ECB rate{ecb?.date ? ` (${ecb.date})` : ""}
                              </th>
                              <th scope="col" className="amount">
                                Euro
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {lines.map((l) => {
                              const rate = l.currency === "EUR" ? 1 : ecb?.rates[l.currency];
                              return (
                                <tr key={l.currency}>
                                  <td>
                                    <code>{l.currency}</code>
                                  </td>
                                  <td>{l.countries.join(", ")}</td>
                                  <td className="num amount">{l.units}</td>
                                  <td className="num amount">{l.amount}</td>
                                  <td className="num amount">{rate ?? "—"}</td>
                                  <td className="num amount">
                                    {rate ? euros(Math.round((Number(l.amount) / rate) * 100)) : "No ECB rate"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {failed ? (
                        <Notice tone="error" className="inline">
                          The invoice failed: {r.invoice?.errorMessage ?? "unknown error"}. Retry or delete it from the{" "}
                          <Link href={`/admin/projects/${project.id}/invoices?status=FAILED`}>failed invoices</Link>;
                          deleting it lets you issue it again with another amount.
                        </Notice>
                      ) : (
                        <form action={issueAppStoreInvoiceAction.bind(null, project.id, r.id)} className="report-form">
                          <div className="fields">
                            <div className="field">
                              <label htmlFor={`amount-${r.id}`}>Amount in euro</label>
                              <input
                                id={`amount-${r.id}`}
                                name="amount"
                                type="text"
                                inputMode="decimal"
                                required
                                defaultValue={r.estimatedCents !== null ? (r.estimatedCents / 100).toFixed(2).replace(".", ",") : ""}
                                aria-describedby={`amount-${r.id}-hint`}
                              />
                              <span className="hint" id={`amount-${r.id}-hint`}>
                                {r.estimatedCents !== null
                                  ? "ECB estimate. Use the Proceeds total of the Payments page."
                                  : "No estimate: type the Proceeds total of the Payments page."}
                              </span>
                            </div>
                            <div className="field">
                              <label htmlFor={`tid-${r.id}`}>Transaction ID</label>
                              <input id={`tid-${r.id}`} name="transactionId" type="text" maxLength={60} aria-describedby={`tid-${r.id}-hint`} />
                              <span className="hint" id={`tid-${r.id}-hint`}>
                                Optional, from the Payments page. Printed in the description.
                              </span>
                            </div>
                            <div className="field">
                              <label htmlFor={`date-${r.id}`}>Invoice date</label>
                              <input id={`date-${r.id}`} name="date" type="date" required defaultValue={today} />
                            </div>
                          </div>
                          <p className="hint">
                            {appStoreDescription(account.appName, { period: r.period, transactionId: null })}.
                            {project.dryRun && " The project is in dry run: the invoice is only validated."}
                          </p>
                          <div className="btn-row">
                            <button type="submit" className="btn">
                              Issue invoice to Apple
                            </button>
                            <button
                              type="submit"
                              formAction={setAppStoreReportDismissedAction.bind(null, project.id, r.id, true)}
                              formNoValidate
                              className="btn secondary"
                            >
                              Already invoiced elsewhere
                            </button>
                          </div>
                        </form>
                      )}
                    </article>
                  );
                })
              )}
            </div>
          </section>

          {done.length > 0 && (
            <section className="section" id="history">
              <SectionHead title="History" />
              <div className="section-body">
                <ul className="usage">
                  {done.map((r) => (
                    <li key={r.id}>
                      <strong>{labelEn(periodFromCode(r.period))}</strong>
                      {r.status === "DISMISSED" ? (
                        <>
                          <span className="hint">Invoiced elsewhere</span>
                          <form action={setAppStoreReportDismissedAction.bind(null, project.id, r.id, false)}>
                            <button type="submit" className="btn small secondary">
                              Undo
                            </button>
                          </form>
                        </>
                      ) : (
                        r.invoice && (
                          <>
                            <StatusMark status={r.invoice.status} />
                            <span>
                              {r.invoice.ficNumber ?? (r.invoice.dryRun ? "Dry run" : "")} · {euros(r.invoice.amountCents)}
                            </span>
                            <Link href={`/admin/projects/${project.id}/invoices`} className="project-next">
                              Invoices
                              <ArrowRight />
                            </Link>
                          </>
                        )
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </>
      )}

      <form action={saveAppStoreAction.bind(null, project.id)}>
        <section className="section" id="settings">
          <SectionHead step={account ? undefined : 1} title="App Store Connect">
            A team API key with the Finance role, from Users and Access → Integrations → App Store Connect API. The
            key only reads financial reports.
          </SectionHead>
          <div className="section-body">
            <div className="fields">
              <div className="field">
                <label htmlFor="issuerId">Issuer ID</label>
                <input id="issuerId" name="issuerId" type="text" required defaultValue={account?.issuerId ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="keyId">Key ID</label>
                <input id="keyId" name="keyId" type="text" required defaultValue={account?.keyId ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="vendorNumber">Vendor number</label>
                <input id="vendorNumber" name="vendorNumber" type="text" inputMode="numeric" required defaultValue={account?.vendorNumber ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="privateKey">Private key (.p8)</label>
                <input id="privateKey" name="privateKey" type="file" accept=".p8" required={!account} aria-describedby="privateKey-hint" />
                <span className="hint" id="privateKey-hint">
                  {account ? "Stored encrypted. Upload only to replace it." : "Stored encrypted, never shown again."}
                </span>
              </div>
              <div className="field">
                <label htmlFor="appName">App name</label>
                <input id="appName" name="appName" type="text" required maxLength={100} defaultValue={account?.appName ?? project.name} />
              </div>
              <div className="field">
                <label htmlFor="startPeriod">{account ? "Next report expected" : "First month to invoice"}</label>
                <select id="startPeriod" name="startPeriod" defaultValue={account?.nextPeriod ?? ""} aria-describedby="startPeriod-hint">
                  {!account && <option value="">The one after the latest report (suggested)</option>}
                  {periodChoices.map((code) => (
                    <option key={code} value={code}>
                      {labelEn(periodFromCode(code))} ({isoDay(periodFromCode(code).start)} – {isoDay(periodFromCode(code).end)})
                    </option>
                  ))}
                </select>
                <span className="hint" id="startPeriod-hint">
                  Earlier reports are taken as already invoiced.
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="invoice">
          <SectionHead step={account ? undefined : 2} title="Invoice to Apple">
            How the monthly invoice looks. Numeration, regime, dry run and sending to SDI come from the project. Not
            tax advice: confirm customer, VAT type and statement with your accountant.
          </SectionHead>
          <div className="section-body">
            {lookups.error && (
              <Notice tone="error" className="inline">
                Could not load the lists from Fatture in Cloud: {lookups.error}
              </Notice>
            )}
            <h3 className="subhead">Customer</h3>
            <div className="fields">
              <div className="field">
                <label htmlFor="customerName">Name</label>
                <input id="customerName" name="customerName" type="text" required defaultValue={customer.name} />
              </div>
              <div className="field">
                <label htmlFor="customerVatNumber">VAT number</label>
                <input id="customerVatNumber" name="customerVatNumber" type="text" required defaultValue={customer.vatNumber} />
              </div>
              <div className="field">
                <label htmlFor="customerAddress">Address</label>
                <input id="customerAddress" name="customerAddress" type="text" defaultValue={customer.address} />
              </div>
              <div className="field">
                <label htmlFor="customerZipCode">Postal code</label>
                <input id="customerZipCode" name="customerZipCode" type="text" defaultValue={customer.zipCode} />
              </div>
              <div className="field">
                <label htmlFor="customerCity">City</label>
                <input id="customerCity" name="customerCity" type="text" defaultValue={customer.city} />
              </div>
              <div className="field">
                <label htmlFor="customerProvince">County / province</label>
                <input id="customerProvince" name="customerProvince" type="text" defaultValue={customer.province} />
              </div>
              <div className="field">
                <label htmlFor="customerCountryCode">Country</label>
                <input
                  id="customerCountryCode"
                  name="customerCountryCode"
                  type="text"
                  required
                  maxLength={2}
                  defaultValue={customer.countryCode}
                  aria-describedby="customerCountryCode-hint"
                />
                <span className="hint" id="customerCountryCode-hint">
                  ISO code. Outside Italy the SDI recipient code is XXXXXXX.
                </span>
              </div>
            </div>
            <h3 className="subhead">Line and payment</h3>
            <div className="fields">
              <div className="field">
                <label htmlFor="itemName">Line name</label>
                <input id="itemName" name="itemName" type="text" required defaultValue={account?.itemName ?? "Distribuzione applicazioni mobili"} />
              </div>
              <IdSelect
                name="vatTypeId"
                label="VAT type"
                value={account?.vatTypeId ?? null}
                options={lookups.vatTypes}
                hint="Operations not subject to VAT, art. 7-ter (N2.1)."
              />
              <IdSelect name="paymentAccountId" label="Payment account" value={account?.paymentAccountId ?? null} options={lookups.paymentAccounts} hint="The bank account Apple pays into." />
              <IdSelect name="paymentMethodId" label="Payment method" value={account?.paymentMethodId ?? null} options={lookups.paymentMethods} hint="Bank transfer." />
              <div className="field">
                <label htmlFor="eiPaymentMethod">SDI payment method</label>
                <input id="eiPaymentMethod" name="eiPaymentMethod" type="text" pattern="MP[0-9]{2}" required defaultValue={account?.eiPaymentMethod ?? "MP05"} aria-describedby="eiPaymentMethod-hint" />
                <span className="hint" id="eiPaymentMethod-hint">
                  MP05 is bank transfer.
                </span>
              </div>
              <div className="field wide">
                <label htmlFor="statement">Statement</label>
                <textarea id="statement" name="statement" maxLength={2000} defaultValue={account?.statement ?? ""} placeholder="Optional, printed in the notes." />
              </div>
            </div>
            {config.fiscalRegime === "FORFETTARIO" && (
              <p className="hint">
                Above €77.47 the €2 stamp duty is declared and borne by you, never charged to Apple
                {config.stampDutyMode === "DISABLED" ? " (disabled for this project)" : ""}.
              </p>
            )}
            <div className="form-foot">
              <button type="submit" className="btn">
                {account ? "Save settings" : "Connect App Store Connect"}
              </button>
            </div>
          </div>
        </section>
      </form>

      {account && (
        <section className="section" id="remove">
          <SectionHead title="Remove">Stops the checks and forgets the key. Invoices already issued are kept.</SectionHead>
          <div className="section-body">
            <form action={removeAppStoreAction.bind(null, project.id)}>
              <button type="submit" className="btn danger">
                Remove App Store settings
              </button>
            </form>
          </div>
        </section>
      )}
    </>
  );
}
