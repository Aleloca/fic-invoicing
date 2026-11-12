import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountMark } from "@/components/badges";
import { ArrowLeft } from "@/components/icons";
import { Notice, Notices } from "@/components/notices";
import { SectionHead } from "@/components/section-head";
import { SettingsFields } from "@/components/settings-fields";
import { prisma } from "@/lib/prisma";
import {
  missingConfiguration,
  NO_OVERRIDES,
  OVERRIDABLE,
  resolveConfig,
  type OverridableKey,
} from "@/lib/projects/config";
import { loadLookups } from "@/lib/projects/lookups";
import { removeCompanyAction, updateCompanyAction } from "../../../actions";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Company" };

const SETTING_LABELS: Record<OverridableKey, string> = {
  vatTypeId: "VAT type",
  nonTaxableVatTypeId: "non-taxable VAT type",
  paymentAccountId: "payment account",
  paymentMethodId: "payment method",
  numeration: "numeration",
  itemCode: "item code",
  eiPaymentMethod: "SDI payment method",
  stampDutyMode: "stamp duty",
  stampDutyVatTypeId: "stamp duty VAT type",
  sendToSdi: "send to SDI",
};

export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { id } = await params;
  const { notice, error } = await searchParams;
  const company = await prisma.company.findUnique({
    where: { id },
    include: { account: true, projects: { orderBy: { name: "asc" } }, _count: { select: { invoices: true } } },
  });
  if (!company) notFound();

  const lookups = await loadLookups(company);
  const missing = missingConfiguration(resolveConfig(company, NO_OVERRIDES).invoice);
  const users = company.projects.map((p) => ({
    ...p,
    custom: OVERRIDABLE.filter((k) => p[k] !== null).map((k) => SETTING_LABELS[k]),
    customStatements: p.fiscalStatements !== null,
  }));
  const following = users.filter((u) => u.custom.length === 0 && !u.customStatements);

  return (
    <>
      <Link href="/admin/fic" className="crumb">
        <ArrowLeft />
        Fatture in Cloud
      </Link>
      <div className="page-head">
        <h1>{company.name}</h1>
        <p className="sub">
          Default invoice settings of this company. Every project using it follows them, except the settings it
          customizes.
        </p>
      </div>
      <Notices notice={notice} error={error} />

      <dl className="facts" style={{ marginBottom: 40 }}>
        <div>
          <dt>Fatture in Cloud account</dt>
          <dd>
            <Link href="/admin/fic">{company.account.label}</Link> <AccountMark account={company.account} />
          </dd>
        </div>
        <div>
          <dt>Company id</dt>
          <dd>
            <code>{company.ficCompanyId}</code>
          </dd>
        </div>
        <div>
          <dt>Projects</dt>
          <dd>{company.projects.length}</dd>
        </div>
      </dl>

      <section className="section" id="projects">
        <SectionHead title="Projects using it">A change below applies to their next invoices.</SectionHead>
        <div className="section-body">
          {users.length === 0 ? (
            <p className="hint">No project uses this company yet.</p>
          ) : (
            <ul className="usage">
              {users.map((u) => (
                <li key={u.id}>
                  <Link href={`/admin/projects/${u.id}#configuration`}>{u.name}</Link>
                  <span className="hint">
                    {u.custom.length === 0 && !u.customStatements
                      ? "Follows every default"
                      : `Customizes ${[...u.custom, ...(u.customStatements ? ["fiscal statements"] : [])].join(", ")}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <form action={updateCompanyAction.bind(null, company.id)}>
        <section className="section" id="configuration">
          <SectionHead title="Default settings">Values come from this Fatture in Cloud company.</SectionHead>
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
                <label htmlFor="fiscalRegime">Fiscal regime</label>
                <select
                  id="fiscalRegime"
                  name="fiscalRegime"
                  defaultValue={company.fiscalRegime}
                  aria-describedby="fiscalRegime-hint"
                >
                  <option value="FORFETTARIO">Forfettario</option>
                  <option value="ORDINARIO">Ordinario</option>
                </select>
                <span className="hint" id="fiscalRegime-hint">
                  Applies to every project of the company.
                </span>
              </div>
            </div>
            <SettingsFields mode="company" regime={company.fiscalRegime} company={company} lookups={lookups} />
            <div className="form-foot">
              <SubmitButton className="btn">
                Save defaults
              </SubmitButton>
              <span className="hint">
                {users.length === 0
                  ? "No project uses it yet."
                  : following.length === users.length
                    ? `Applies to ${users.map((u) => u.name).join(", ")}.`
                    : `Applies to ${users.length} ${users.length === 1 ? "project" : "projects"}, except the settings they customize.`}
              </span>
            </div>
          </div>
        </section>
      </form>

      {users.length === 0 && company._count.invoices === 0 && (
        <section className="section" id="remove">
          <SectionHead title="Remove">Unused: no project and no invoice refer to it.</SectionHead>
          <div className="section-body">
            <form action={removeCompanyAction.bind(null, company.id)}>
              <SubmitButton className="btn danger">
                Remove this company
              </SubmitButton>
            </form>
          </div>
        </section>
      )}
    </>
  );
}
