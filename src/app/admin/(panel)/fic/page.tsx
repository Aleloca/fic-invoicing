import type { Metadata } from "next";
import Link from "next/link";
import { AccountMark } from "@/components/badges";
import { ArrowRight, Plus } from "@/components/icons";
import { Notice, Notices } from "@/components/notices";
import { dateTime } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { consolidateAccounts } from "@/lib/projects/accounts";
import {
  connectAccountAction,
  disconnectAccountAction,
  reconnectAccountAction,
  removeAccountAction,
  renameAccountAction,
} from "../../actions";

export const metadata: Metadata = { title: "Fatture in Cloud" };

export default async function FicAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  await consolidateAccounts();
  const accounts = await prisma.ficAccount.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      companies: {
        orderBy: { name: "asc" },
        include: {
          projects: { orderBy: { name: "asc" }, select: { id: true, name: true } },
          _count: { select: { invoices: true } },
        },
      },
    },
  });

  return (
    <>
      <div className="page-head">
        <h1>Fatture in Cloud</h1>
        <div className="actions">
          <form action={connectAccountAction.bind(null, null)}>
            <button type="submit" className="btn">
              <Plus />
              Connect an account
            </button>
          </form>
        </div>
        <p className="sub">
          Each account is one Fatture in Cloud login. Its companies hold the default invoice settings; every project
          using a company inherits them. Reconnecting an account fixes all its projects at once.
        </p>
      </div>
      <Notices notice={notice} error={error} />

      {accounts.length === 0 ? (
        <div className="empty">
          <h2>No account connected</h2>
          <p>
            Connect the Fatture in Cloud user that owns your company. You can connect several users, for example one per
            business.
          </p>
          <form action={connectAccountAction.bind(null, null)}>
            <button type="submit" className="btn">
              <Plus />
              Connect Fatture in Cloud
            </button>
          </form>
        </div>
      ) : (
        <ul className="accounts">
          {accounts.map((account) => {
            const connected = account.refreshTokenEnc !== null && !account.needsReconnect;
            const inUse = account.companies.some((c) => c.projects.length > 0 || c._count.invoices > 0);
            return (
              <li key={account.id} className="account">
                <div className="account-head">
                  <div>
                    <h2 className="account-name">{account.label}</h2>
                    <div className="project-meta">
                      {account.ficUserEmail && <span>{account.ficUserEmail}</span>}
                      <AccountMark account={account} />
                      {connected && account.tokenExpiresAt && (
                        <span>Token renews {dateTime(account.tokenExpiresAt)}</span>
                      )}
                    </div>
                  </div>
                  <div className="btn-row">
                    <form action={reconnectAccountAction.bind(null, account.id, null)}>
                      <button type="submit" className={`btn small${connected ? " secondary" : ""}`}>
                        Reconnect
                      </button>
                    </form>
                    {account.refreshTokenEnc && (
                      <form action={disconnectAccountAction.bind(null, account.id)}>
                        <button type="submit" className="btn small danger">
                          Disconnect
                        </button>
                      </form>
                    )}
                    {!inUse && (
                      <form action={removeAccountAction.bind(null, account.id)}>
                        <button type="submit" className="btn small danger">
                          Remove
                        </button>
                      </form>
                    )}
                  </div>
                </div>
                {account.lastError && (
                  <Notice tone="error" className="inline">
                    {account.lastError}
                  </Notice>
                )}

                {account.companies.length === 0 ? (
                  <p className="hint">
                    No company set up yet. Choosing a company for a project sets it up here, with its default settings.
                  </p>
                ) : (
                  <ul className="company-rows">
                    {account.companies.map((c) => (
                      <li key={c.id} className="company-row">
                        <div>
                          <Link href={`/admin/companies/${c.id}`} className="company-name">
                            {c.name}
                          </Link>
                          <div className="project-meta">
                            <span>#{c.ficCompanyId}</span>
                            <span>{c.fiscalRegime === "FORFETTARIO" ? "Forfettario" : "Ordinario"}</span>
                          </div>
                        </div>
                        <div className="company-projects">
                          {c.projects.length === 0 ? (
                            <span className="hint">No projects</span>
                          ) : (
                            c.projects.map((p, i) => (
                              <span key={p.id}>
                                <Link href={`/admin/projects/${p.id}`}>{p.name}</Link>
                                {i < c.projects.length - 1 ? ", " : ""}
                              </span>
                            ))
                          )}
                        </div>
                        <Link href={`/admin/companies/${c.id}`} className="project-next">
                          Default settings
                          <ArrowRight />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}

                <details className="rename">
                  <summary>Rename</summary>
                  <form action={renameAccountAction.bind(null, account.id)} className="rename-form">
                    <label htmlFor={`label-${account.id}`} className="visually-hidden">
                      Account name
                    </label>
                    <input
                      id={`label-${account.id}`}
                      name="label"
                      type="text"
                      defaultValue={account.label}
                      maxLength={100}
                      required
                    />
                    <button type="submit" className="btn small secondary">
                      Save
                    </button>
                  </form>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
