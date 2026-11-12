import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppleSettingsForm } from "@/components/apple-settings-form";
import { ArrowLeft } from "@/components/icons";
import { InvoiceActions, invoiceNotice } from "@/components/invoice-actions";
import { INVOICE_ROW_SELECT, InvoiceTable } from "@/components/invoice-table";
import { LiveTotal } from "@/components/live-total";
import { Notice, Notices } from "@/components/notices";
import { SectionHead } from "@/components/section-head";
import { labelEn, periodFromCode } from "@/lib/appstore/calendar";
import { companyChoices } from "@/lib/appstore/companies";
import type { EcbRates } from "@/lib/appstore/ecb";
import { groupReport, lineEuroCents, suggestProject } from "@/lib/appstore/groups";
import { productsWithProjects } from "@/lib/appstore/apps";
import { appStoreDescription, DEFAULT_DESCRIPTION } from "@/lib/appstore/payload";
import type { ReportLine } from "@/lib/appstore/report";
import { todayInItaly } from "@/lib/fiscal/payload";
import { dateOnly, dateTime, euros } from "@/lib/format";
import { APPLE_ACCOUNT_INCLUDE } from "@/lib/invoices/service";
import { prisma } from "@/lib/prisma";
import { connectionState } from "@/lib/projects/config";
import { loadLookups } from "@/lib/projects/lookups";
import {
  assignAppleProductsAction,
  checkAppleAccountAction,
  discoverAppleProductsAction,
  issueAppleInvoiceAction,
  removeAppleAccountAction,
  setAppleReportDismissedAction,
} from "../../../actions";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Apple account" };

const periodRange = (code: string) => {
  const p = periodFromCode(code);
  return `${dateOnly(p.start)} – ${dateOnly(p.end)}`;
};
const euroInput = (cents: number | null) => (cents !== null ? (cents / 100).toFixed(2).replace(".", ",") : "");

export default async function AppleAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const account = await prisma.appleAccount.findUnique({ where: { id }, include: APPLE_ACCOUNT_INCLUDE });
  if (!account) notFound();

  const [reports, products, projects, invoices, companies] = await Promise.all([
    prisma.appStoreReport.findMany({
      where: { accountId: account.id },
      orderBy: { period: "desc" },
      include: { invoice: { select: { id: true, status: true, ficNumber: true, amountCents: true, errorMessage: true, dryRun: true } } },
    }),
    productsWithProjects(account.id),
    prisma.project.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } }),
    prisma.invoice.findMany({
      where: { appleAccountId: account.id },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: { ...INVOICE_ROW_SELECT, appleAccount: { select: { id: true, label: true } } },
    }),
    companyChoices(),
  ]);
  const lookups = await loadLookups(account.company && connectionState({ company: account.company }) === "ready" ? account.company : null);
  const open = reports.filter((r) => r.status === "READY");
  const done = reports.filter((r) => r.status !== "READY");
  const apps = await prisma.appleApp.findMany({ where: { accountId: account.id }, orderBy: { name: "asc" } });
  const orphans = products.filter((p) => !p.appId).sort((a, b) => a.title.localeCompare(b.title));
  const unassigned = products.filter((p) => !p.projectId);
  const unassignedApps = apps.filter((a) => !a.projectId && products.some((p) => p.appId === a.id));
  const today = todayInItaly();
  const { notice, error } = query.notice?.startsWith("retry") || query.notice?.startsWith("delete") ? { ...invoiceNotice(query.notice), error: query.error } : query;

  return (
    <>
      <Link href="/admin/apple" className="crumb">
        <ArrowLeft />
        Apple
      </Link>
      <div className="page-head">
        <h1>{account.label}</h1>
        <div className="actions">
          <form action={checkAppleAccountAction.bind(null, account.id)}>
            <SubmitButton className="btn secondary">
              Check now
            </SubmitButton>
          </form>
        </div>
        <p className="sub">
          When Apple publishes the financial report of a fiscal month it shows up here, with the euro amounts estimated
          at the ECB rate of that day. Compare them with the Payments page of App Store Connect, then issue the invoice.
        </p>
      </div>
      <Notices notice={notice} error={error} />

      <dl className="facts" style={{ marginBottom: 40 }}>
        <div>
          <dt>Next report expected</dt>
          <dd>
            {labelEn(periodFromCode(account.nextPeriod))} <span className="hint">({periodRange(account.nextPeriod)})</span>
          </dd>
        </div>
        <div>
          <dt>Last check</dt>
          <dd>{account.lastCheckedAt ? dateTime(account.lastCheckedAt) : "Not yet"}</dd>
        </div>
        <div>
          <dt>Issued by</dt>
          <dd>
            {account.company ? account.company.name : "No company"}
            {account.dryRun && (
              <>
                {" "}
                <span className="mark dry">Dry run</span>
              </>
            )}
          </dd>
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
        <SectionHead title="To invoice">One invoice per report, one line per project. Checked every 6 hours.</SectionHead>
        <div className="section-body">
          {open.length === 0 ? (
            <p className="hint">Nothing to invoice. The next report is {labelEn(periodFromCode(account.nextPeriod))}.</p>
          ) : (
            open.map((r) => {
              const lines = r.lines as unknown as ReportLine[];
              const ecb = r.ecbRates as unknown as EcbRates | null;
              const groups = groupReport(lines, products, ecb?.rates);
              const failed = r.invoice?.status === "FAILED";
              const formId = `report-${r.id}`;
              const estimate = groups.groups.reduce((sum, g) => sum + (g.estimatedCents ?? 0), 0);
              return (
                <article key={r.id} className="report-card">
                  <header className="report-head">
                    <h3>{labelEn(periodFromCode(r.period))}</h3>
                    <span className="hint">
                      {periodRange(r.period)} · found {dateOnly(r.detectedAt)}
                      {ecb?.date && ` · ECB rates of ${ecb.date}`}
                    </span>
                  </header>
                  {groups.unassigned.length > 0 && (
                    <Notice tone="warn" className="inline">
                      Assign the app of {[...new Set(groups.unassigned.map((l) => `“${l.title || l.sku || l.appleId}”`))].join(", ")} to a project
                      in <a href="#products">Apps</a> to invoice this report.
                    </Notice>
                  )}
                  <div className="table-wrap cards">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Project</th>
                          <th scope="col">Product</th>
                          <th scope="col">Countries</th>
                          <th scope="col" className="amount">
                            Proceeds
                          </th>
                          <th scope="col" className="amount">
                            ECB rate
                          </th>
                          <th scope="col" className="amount">
                            Euro
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ...groups.groups.flatMap((g) => g.lines.map((l) => ({ project: g.appName ? `${g.projectName} · ${g.appName}` : g.projectName, l }))),
                          ...groups.unassigned.map((l) => ({ project: "Not assigned", l })),
                        ].map(({ project, l }) => {
                          const euro = lineEuroCents(l, ecb?.rates);
                          return (
                            <tr key={`${l.appleId}-${l.currency}`}>
                              <td data-label="">{project}</td>
                              <td data-label="Product">
                                <span>
                                  {l.title || l.sku}
                                  <span className="cell-sub">{l.units} sold</span>
                                </span>
                              </td>
                              <td data-label="Countries">{l.countries.join(", ")}</td>
                              <td className="num amount" data-label="Proceeds">
                                <span>
                                  {l.amount} <code>{l.currency}</code>
                                </span>
                              </td>
                              <td className="num amount" data-label="ECB rate">
                                {l.currency === "EUR" ? "—" : (ecb?.rates[l.currency] ?? "—")}
                              </td>
                              <td className="num amount" data-label="Euro">
                                {euro !== null ? euros(euro) : "No ECB rate"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {failed ? (
                    <Notice tone="error" className="inline">
                      The invoice failed: {r.invoice?.errorMessage ?? "unknown error"}. Retry or delete it below in{" "}
                      <a href="#invoices">Invoices to Apple</a>; deleting it lets you issue it again with other amounts.
                    </Notice>
                  ) : (
                    groups.unassigned.length === 0 && (
                      <form id={formId} action={issueAppleInvoiceAction.bind(null, account.id, r.id)} className="report-form">
                        <div className="fields">
                          {groups.groups.map((g) => (
                            <div className="field" key={g.key}>
                              <label htmlFor={`${formId}-${g.key}`}>{g.appName ?? g.projectName}, euro</label>
                              <input
                                id={`${formId}-${g.key}`}
                                name={`amount_${g.key}`}
                                type="text"
                                inputMode="decimal"
                                required
                                defaultValue={euroInput(g.estimatedCents)}
                              />
                              <span className="hint">
                                <strong>{g.itemName || account.itemName}</strong>:{" "}
                                {appStoreDescription(g.projectName, { period: r.period, transactionId: null }, g.description)}
                              </span>
                            </div>
                          ))}
                          <div className="field">
                            <label htmlFor={`${formId}-tid`}>Transaction ID</label>
                            <input id={`${formId}-tid`} name="transactionId" type="text" maxLength={60} />
                            <span className="hint">Optional, from the Payments page. Printed in every line.</span>
                          </div>
                          <div className="field">
                            <label htmlFor={`${formId}-date`}>Invoice date</label>
                            <input id={`${formId}-date`} name="date" type="date" required defaultValue={today} />
                          </div>
                        </div>
                        <p className="report-total">
                          Total <LiveTotal formId={formId} initialCents={estimate} />
                          <span className="hint">
                            Should match the Proceeds total of the Payments page.
                            {account.dryRun && " Dry run: the invoice is only validated."}
                          </span>
                        </p>
                        <div className="btn-row">
                          <SubmitButton className="btn">
                            Issue invoice to Apple
                          </SubmitButton>
                          <SubmitButton formAction={setAppleReportDismissedAction.bind(null, account.id, r.id, true)} formNoValidate className="btn secondary">
                            Already invoiced elsewhere
                          </SubmitButton>
                        </div>
                      </form>
                    )
                  )}
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className="section" id="products">
        <SectionHead title="Apps">
          Assign each app to its project, once. Its products, in-app purchases included, follow it: the app of each
          product comes from App Store Connect.
        </SectionHead>
        <div className="section-body">
          <form action={discoverAppleProductsAction.bind(null, account.id)}>
            <SubmitButton className="btn secondary small">
              Load apps and products
            </SubmitButton>
          </form>
          {apps.length === 0 && orphans.length === 0 ? (
            <p className="hint">Nothing yet. Load the apps and the products sold in the last two years.</p>
          ) : (
            <form action={assignAppleProductsAction.bind(null, account.id)}>
              {(unassignedApps.length > 0 || unassigned.length > 0) && (
                <Notice tone="warn" className="inline">
                  Some apps or products sell without a project. A project whose name matches is proposed: check it and
                  save.
                </Notice>
              )}
              <ul className="usage">
                {apps.map((app) => {
                  const sold = products.filter((p) => p.appId === app.id);
                  const suggested = app.projectId ? null : suggestProject({ sku: app.sku, title: app.name }, projects);
                  const projectName = projects.find((p) => p.id === (app.projectId ?? suggested?.id))?.name ?? app.name;
                  const custom = Boolean(app.invoiceItemName || app.invoiceDescription);
                  return (
                    <li key={app.id} className="app-row">
                      <div className="product-row">
                        <span>
                          <strong>{app.name}</strong>
                          <span className="cell-sub">
                            {sold.length > 0 ? sold.map((p) => p.title || p.sku).join(", ") : "No sales in the reports read"}
                          </span>
                        </span>
                        <label className="visually-hidden" htmlFor={`app_${app.id}`}>
                          Project of {app.name}
                        </label>
                        <select id={`app_${app.id}`} name={`app_${app.id}`} defaultValue={app.projectId ?? suggested?.id ?? ""}>
                          <option value="">Not assigned</option>
                          {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                              {suggested?.id === project.id ? " (proposed)" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <details className="app-line" open={custom}>
                        <summary>Invoice line{custom ? "" : ": default"}</summary>
                        <div className="fields">
                          <div className="field">
                            <label htmlFor={`appItem_${app.id}`}>Line name</label>
                            <input
                              id={`appItem_${app.id}`}
                              name={`appItem_${app.id}`}
                              type="text"
                              maxLength={191}
                              defaultValue={app.invoiceItemName ?? ""}
                              placeholder={account.itemName}
                            />
                          </div>
                          <div className="field wide">
                            <label htmlFor={`appDescription_${app.id}`}>Description</label>
                            <textarea
                              id={`appDescription_${app.id}`}
                              name={`appDescription_${app.id}`}
                              maxLength={1000}
                              defaultValue={app.invoiceDescription ?? ""}
                              placeholder={DEFAULT_DESCRIPTION}
                              aria-describedby={`appDescription_${app.id}-hint`}
                            />
                            <span className="hint" id={`appDescription_${app.id}-hint`}>
                              Empty uses the text shown. <code>{"{app}"}</code> is the project name, <code>{"{periodo}"}</code> the
                              fiscal month, <code>{"{transaction}"}</code> becomes &ldquo;, Transaction ID: …&rdquo; when you type
                              one. Example:{" "}
                              {appStoreDescription(projectName, { period: account.nextPeriod, transactionId: "411399920" }, app.invoiceDescription)}
                            </span>
                          </div>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
              {orphans.length > 0 && (
                <>
                  <h3 className="subhead">Products without an app</h3>
                  <p className="hint">App Store Connect did not say which app these belong to: assign them directly.</p>
                  <ul className="usage">
                    {orphans.map((p) => {
                      const suggested = p.projectId ? null : suggestProject(p, projects);
                      return (
                        <li key={p.id} className="product-row">
                          <span>
                            <strong>{p.title || p.sku}</strong>
                            <span className="cell-sub">
                              <code>{p.sku}</code> · Apple ID {p.appleId}
                            </span>
                          </span>
                          <label className="visually-hidden" htmlFor={`product_${p.id}`}>
                            Project of {p.title || p.sku}
                          </label>
                          <select id={`product_${p.id}`} name={`product_${p.id}`} defaultValue={p.projectId ?? suggested?.id ?? ""}>
                            <option value="">Not assigned</option>
                            {projects.map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.name}
                                {suggested?.id === project.id ? " (proposed)" : ""}
                              </option>
                            ))}
                          </select>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
              <div className="form-foot" style={{ paddingTop: 16 }}>
                <SubmitButton className={`btn${unassignedApps.length || unassigned.length ? "" : " secondary"}`}>
                  Save apps
                </SubmitButton>
              </div>
            </form>
          )}
        </div>
      </section>

      {invoices.length > 0 && (
        <section className="section" id="invoices">
          <SectionHead title="Invoices to Apple" />
          <div className="section-body">
            <InvoiceTable
              invoices={invoices}
              actions={(inv) => <InvoiceActions inv={inv} owner={{ appleAccountId: account.id }} returnTo={`/admin/apple/${account.id}`} />}
            />
          </div>
        </section>
      )}

      {done.length > 0 && (
        <section className="section" id="history">
          <SectionHead title="Reports" />
          <div className="section-body">
            <ul className="usage">
              {done.map((r) => (
                <li key={r.id}>
                  <strong>{labelEn(periodFromCode(r.period))}</strong>
                  {r.status === "DISMISSED" ? (
                    <>
                      <span className="hint">Invoiced elsewhere</span>
                      <form action={setAppleReportDismissedAction.bind(null, account.id, r.id, false)}>
                        <SubmitButton className="btn small secondary">
                          Undo
                        </SubmitButton>
                      </form>
                    </>
                  ) : (
                    r.invoice && (
                      <span className="hint">
                        Invoice {r.invoice.ficNumber ?? (r.invoice.dryRun ? "(dry run)" : "")} · {euros(r.invoice.amountCents)}
                      </span>
                    )
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <AppleSettingsForm account={account} companies={companies} lookups={lookups} />

      <section className="section" id="remove">
        <SectionHead title="Remove">Stops the checks and forgets the key. Not possible once it has invoices.</SectionHead>
        <div className="section-body">
          <form action={removeAppleAccountAction.bind(null, account.id)}>
            <SubmitButton className="btn danger">
              Remove this Apple account
            </SubmitButton>
          </form>
        </div>
      </section>
    </>
  );
}
