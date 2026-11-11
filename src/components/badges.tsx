import type { InvoiceStatus } from "@prisma/client";
import { connectionState, type CompanyWithAccount } from "@/lib/projects/config";

/** How a project's company stands with Fatture in Cloud. */
export function ConnectionMark({ company }: { company: CompanyWithAccount | null }) {
  const state = connectionState({ company });
  if (state === "no_company") return <span className="mark off">No company</span>;
  if (state === "reconnect") return <span className="mark failed">Reconnect required</span>;
  if (state === "not_connected") return <span className="mark attention">Account disconnected</span>;
  return <span className="mark connected">{company!.name}</span>;
}

/** How a Fatture in Cloud account stands. */
export function AccountMark({ account }: { account: CompanyWithAccount["account"] }) {
  if (account.needsReconnect) return <span className="mark failed">Reconnect required</span>;
  if (!account.refreshTokenEnc) return <span className="mark off">Disconnected</span>;
  return <span className="mark connected">Connected</span>;
}

/** Plain-language meaning of each invoice status, for readers who do not know the API. */
export const STATUS_INFO: Record<InvoiceStatus, { label: string; tone: string; meaning: string }> = {
  ISSUED: {
    label: "Issued",
    tone: "issued",
    meaning: "Created in Fatture in Cloud with its number. With dry run it was only validated.",
  },
  PENDING: {
    label: "Pending",
    tone: "pending",
    meaning: "The request arrived and is being processed. It should not stay here for long.",
  },
  FAILED: {
    label: "Failed",
    tone: "failed",
    meaning: "Fatture in Cloud refused it or could not be reached. No number was used; it can be retried.",
  },
  DELETED: {
    label: "Deleted",
    tone: "deleted",
    meaning: "Deleted by an admin before it was sent to SDI, from Fatture in Cloud too when a document existed. Kept for the record.",
  },
};

export function StatusMark({ status }: { status: InvoiceStatus }) {
  const info = STATUS_INFO[status];
  return (
    <span className={`mark ${info.tone}`} title={info.meaning}>
      {info.label}
    </span>
  );
}

export function StatusLegend() {
  return (
    <dl className="legend">
      {(Object.keys(STATUS_INFO) as InvoiceStatus[]).map((s) => (
        <div key={s}>
          <dt>
            <StatusMark status={s} />
          </dt>
          <dd>{STATUS_INFO[s].meaning}</dd>
        </div>
      ))}
      <div>
        <dt>
          <span className="tag dry">Dry run</span>
        </dt>
        <dd>A test: checked against Fatture in Cloud&apos;s totals, but no real invoice exists.</dd>
      </div>
    </dl>
  );
}
