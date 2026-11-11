import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountMark } from "@/components/badges";
import { ArrowLeft, Plus } from "@/components/icons";
import { Notice, Notices } from "@/components/notices";
import { listUserCompanies, type FicCompany } from "@/lib/fic/client";
import { getFicAccess } from "@/lib/fic/tokens";
import { prisma } from "@/lib/prisma";
import { consolidateAccounts } from "@/lib/projects/accounts";
import { connectAccountAction, reconnectAccountAction, selectCompanyAction } from "../../../../actions";

export const metadata: Metadata = { title: "Choose the company" };

export default async function CompanyPickerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, company: { select: { accountId: true, ficCompanyId: true } } },
  });
  if (!project) notFound();

  await consolidateAccounts();
  const accounts = await prisma.ficAccount.findMany({
    orderBy: { createdAt: "asc" },
    include: { companies: { include: { _count: { select: { projects: true } } } } },
  });

  // Every company each usable account can reach, read live from Fatture in Cloud.
  const groups = await Promise.all(
    accounts.map(async (account) => {
      const usable = !account.needsReconnect && account.refreshTokenEnc !== null;
      let companies: FicCompany[] = [];
      let loadError: string | null = null;
      if (usable) {
        try {
          companies = await listUserCompanies(await getFicAccess(account.id));
        } catch (e) {
          loadError = e instanceof Error ? e.message : "Could not list companies";
        }
      }
      return { account, usable, companies, loadError };
    }),
  );
  const current = project.company ? `${project.company.accountId}:${project.company.ficCompanyId}` : null;
  const anyCompany = groups.some((g) => g.companies.length > 0);

  return (
    <div style={{ maxWidth: 760 }}>
      <Link href={`/admin/projects/${project.id}`} className="crumb">
        <ArrowLeft />
        {project.name}
      </Link>
      <div className="page-head">
        <h1>Choose the company</h1>
        <p className="sub">
          {project.name} issues its invoices from this Fatture in Cloud company and starts from its settings. Companies
          of every connected account are listed.
        </p>
      </div>
      <Notices error={error} />

      {accounts.length === 0 ? (
        <div className="empty">
          <h2>No Fatture in Cloud account yet</h2>
          <p>Connect the Fatture in Cloud user that owns the company. Its companies then show up here.</p>
          <form action={connectAccountAction.bind(null, project.id)}>
            <button type="submit" className="btn">
              <Plus />
              Connect Fatture in Cloud
            </button>
          </form>
        </div>
      ) : (
        <form action={selectCompanyAction.bind(null, project.id)}>
          {groups.map(({ account, usable, companies, loadError }) => {
            const known = new Map(account.companies.map((c) => [c.ficCompanyId, c._count.projects]));
            return (
              <fieldset key={account.id} className="account-group">
                <legend>
                  <span className="account-name">{account.label}</span>
                  {account.ficUserEmail && <span className="hint">{account.ficUserEmail}</span>}
                  <AccountMark account={account} />
                </legend>
                {loadError && (
                  <Notice tone="error" className="inline">
                    {loadError}
                  </Notice>
                )}
                {!usable ? (
                  <div className="btn-row">
                    <button
                      type="submit"
                      formAction={reconnectAccountAction.bind(null, account.id, project.id)}
                      formNoValidate
                      className="btn secondary"
                    >
                      Reconnect to list its companies
                    </button>
                  </div>
                ) : companies.length === 0 && !loadError ? (
                  <p className="hint">This Fatture in Cloud user has no companies.</p>
                ) : (
                  <div className="choices">
                    {companies.map((c) => {
                      const value = `${account.id}:${c.id}`;
                      const users = known.get(c.id);
                      return (
                        <label key={value} className="choice">
                          <input
                            type="radio"
                            name="company"
                            value={value}
                            required
                            defaultChecked={value === current}
                          />
                          <span>
                            <strong>{c.name}</strong> <span className="hint">#{c.id}</span>
                            <span className="choice-note">
                              {users === undefined
                                ? "Not set up yet: you set its defaults next"
                                : users === 0
                                  ? "Set up, no projects yet"
                                  : `Set up, used by ${users} ${users === 1 ? "project" : "projects"}`}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </fieldset>
            );
          })}
          <div className="form-foot" style={{ paddingTop: 24 }}>
            {anyCompany && (
              <button type="submit" className="btn">
                Use this company
              </button>
            )}
            <button
              type="submit"
              formAction={connectAccountAction.bind(null, project.id)}
              formNoValidate
              className="btn secondary"
            >
              <Plus />
              Connect another account
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
