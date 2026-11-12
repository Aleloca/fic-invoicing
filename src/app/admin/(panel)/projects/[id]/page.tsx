import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConnectionMark } from "@/components/badges";
import { ArrowLeft, ArrowRight } from "@/components/icons";
import { Notice, Notices } from "@/components/notices";
import { SectionHead } from "@/components/section-head";
import { SettingsFields } from "@/components/settings-fields";
import { SetupLine, setupProgress } from "@/components/setup-line";
import { dateOnly } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import {
  connectionState,
  EMPTY_COMPANY_DEFAULTS,
  missingConfiguration,
  PROJECT_INCLUDE,
  resolveConfig,
} from "@/lib/projects/config";
import { loadLookups } from "@/lib/projects/lookups";
import { reconnectAccountAction, updateProjectAction } from "../../../actions";
import { RotateKeyForm } from "./rotate-key-form";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({
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

  const { company } = project;
  const state = connectionState(project);
  const resolved = resolveConfig(company, project);
  const missing = missingConfiguration(resolved.invoice);
  const progress = setupProgress(project);
  const lookups = await loadLookups(state === "ready" ? company : null);
  // Apple apps of this project, and products assigned directly (their app is unknown).
  const appleItems = [
    ...(await prisma.appleApp.findMany({
      where: { projectId: project.id },
      orderBy: { name: "asc" },
      include: { account: { select: { id: true, label: true } } },
    })).map((a) => ({ id: a.id, name: a.name, account: a.account })),
    ...(await prisma.appleProduct.findMany({
      where: { projectId: project.id, appId: null },
      orderBy: { title: "asc" },
      include: { account: { select: { id: true, label: true } } },
    })).map((p) => ({ id: p.id, name: p.title || p.sku, account: p.account })),
  ];

  // Projects on the same company with the same effective numeration share one number sequence.
  const siblings = company
    ? await prisma.project.findMany({
        where: { companyId: company.id, id: { not: project.id } },
        include: PROJECT_INCLUDE,
      })
    : [];
  const sameSequence = siblings.filter(
    (s) => resolveConfig(s.company, s).invoice.numeration === resolved.invoice.numeration,
  );

  return (
    <>
      <Link href="/admin" className="crumb">
        <ArrowLeft />
        Projects
      </Link>
      <div className="page-head">
        <h1>{project.name}</h1>
        <div className="actions">
          <Link className="btn secondary" href={`/admin/projects/${project.id}/invoices`}>
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
            <code>{project.slug}</code>
          </dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>
            {project.dryRun ? <span className="mark dry">Dry run</span> : <span className="mark live">Live</span>}
          </dd>
        </div>
        <div>
          <dt>API key</dt>
          <dd>
            {project.active ? "Accepted" : "Refused (project disabled)"}, starts with{" "}
            <code>{project.apiKeyPrefix}…</code>
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{dateOnly(project.createdAt)}</dd>
        </div>
      </dl>

      <section className="section" id="connection" aria-labelledby="connection-title">
        <SectionHead step={1} done={state === "ready"} title="Company">
          The Fatture in Cloud company that issues this project&apos;s invoices. Several projects can share one.
        </SectionHead>
        <div className="section-body">
          <dl className="facts">
            <div>
              <dt id="connection-title">Company</dt>
              <dd>
                <ConnectionMark company={company} />
              </dd>
            </div>
            {company && (
              <>
                <div>
                  <dt>Fatture in Cloud account</dt>
                  <dd>
                    <Link href="/admin/fic">{company.account.label}</Link>
                  </dd>
                </div>
                <div>
                  <dt>Regime</dt>
                  <dd>{company.fiscalRegime === "FORFETTARIO" ? "Forfettario" : "Ordinario"}</dd>
                </div>
              </>
            )}
          </dl>
          {company?.account.lastError && (
            <Notice tone="error" className="inline">
              {company.account.lastError}
            </Notice>
          )}
          <div className="btn-row">
            {company && (state === "reconnect" || state === "not_connected") && (
              <form action={reconnectAccountAction.bind(null, company.accountId, project.id)}>
                <SubmitButton className="btn">
                  Reconnect {company.account.label}
                </SubmitButton>
              </form>
            )}
            <Link className={`btn${company ? " secondary" : ""}`} href={`/admin/projects/${project.id}/company`}>
              {company ? "Change company" : "Choose the company"}
            </Link>
            {company && (
              <Link className="btn secondary" href={`/admin/companies/${company.id}`}>
                Company settings
              </Link>
            )}
          </div>
        </div>
      </section>

      <form action={updateProjectAction.bind(null, project.id)}>
        <section className="section" id="configuration">
          <SectionHead step={2} done={state === "ready" && missing.length === 0} title="Invoice settings">
            Every setting follows the company unless you mark it <em>Custom</em> for this project.
          </SectionHead>
          <div className="section-body">
            {!company && (
              <Notice tone="info" className="inline">
                Choose a company first: its settings become this project&apos;s defaults.
              </Notice>
            )}
            {lookups.error && (
              <Notice tone="error" className="inline">
                Could not load the lists from Fatture in Cloud: {lookups.error}
              </Notice>
            )}
            {company && missing.length > 0 && (
              <Notice tone="warn" className="inline">
                <strong>Still missing:</strong> {missing.join(", ")}. Set it on the{" "}
                <Link href={`/admin/companies/${company.id}`}>company</Link>, or customize it here.
              </Notice>
            )}
            {sameSequence.length > 0 && (
              <Notice tone="info" className="inline">
                Shares the number sequence of {company?.name} with {sameSequence.map((s) => s.name).join(", ")}: same
                company, same numeration. Customize the numeration (for example <code>/B</code>) to keep them apart.
              </Notice>
            )}
            <div className="fields">
              <div className="field">
                <label htmlFor="name">Name</label>
                <input id="name" name="name" type="text" defaultValue={project.name} required maxLength={100} />
              </div>
            </div>
            <SettingsFields
              mode="project"
              regime={resolved.invoice.fiscalRegime}
              company={company ?? EMPTY_COMPANY_DEFAULTS}
              project={project}
              lookups={lookups}
            />
          </div>
        </section>

        <section className="section" id="going-live">
          <SectionHead step={3} done={progress.live} title="Going live">
            Keep dry run on until a test invoice looks right to you and your accountant.
          </SectionHead>
          <div className="section-body">
            <div className="toggles">
              <label className="toggle">
                <input type="checkbox" name="dryRun" defaultChecked={project.dryRun} />
                <strong>Dry run</strong>
                <span className="hint">
                  Every invoice is validated with Fatture in Cloud&apos;s totals endpoint and nothing is created there.
                </span>
              </label>
              <label className="toggle">
                <input type="checkbox" name="active" defaultChecked={project.active} />
                <strong>Project active</strong>
                <span className="hint">When off, the API key is refused and the app cannot issue invoices.</span>
              </label>
            </div>
            <div className="form-foot">
              <SubmitButton className="btn">
                Save settings
              </SubmitButton>
              <span className="hint">Saves sections 2 and 3 together.</span>
            </div>
          </div>
        </section>
      </form>

      <section className="section" id="app-store">
        <SectionHead title="App Store">
          Apps sold through Apple: Apple pays the account, which is invoiced once a month with a line for this project.
        </SectionHead>
        <div className="section-body">
          {appleItems.length > 0 ? (
            <ul className="usage">
              {appleItems.map((p) => (
                <li key={p.id}>
                  <strong>{p.name}</strong>
                  <Link href={`/admin/apple/${p.account.id}`}>{p.account.label}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">
              No Apple app. Connect the App Store Connect account in <Link href="/admin/apple">Apple</Link> and assign its
              apps to projects there.
            </p>
          )}
        </div>
      </section>

      <section className="section" id="api-key">
        <SectionHead title="API key">
          Your app sends it as <code>Authorization: Bearer</code>. Rotating it stops the current key at once.
        </SectionHead>
        <div className="section-body">
          <RotateKeyForm projectId={project.id} prefix={project.apiKeyPrefix} />
        </div>
      </section>
    </>
  );
}
