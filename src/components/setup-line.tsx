import type { Tenant } from "@prisma/client";

export type SetupTenant = Pick<
  Tenant,
  | "id"
  | "active"
  | "accessTokenEnc"
  | "ficNeedsReconnect"
  | "ficCompanyId"
  | "vatTypeId"
  | "paymentAccountId"
  | "paymentMethodId"
  | "fiscalRegime"
  | "stampDutyMode"
  | "stampDutyVatTypeId"
  | "dryRun"
>;

type StopState = "done" | "current" | "problem" | "todo";

export interface SetupStop {
  key: "created" | "connected" | "company" | "configured" | "dryrun" | "live";
  label: string;
  state: StopState;
}

export interface SetupProgress {
  stops: SetupStop[];
  /** Index of the furthest stop reached (0 = created). */
  reached: number;
  live: boolean;
  /** What the operator should do next, or null when the tenant is live and healthy. */
  next: { label: string; href: string; problem: boolean } | null;
}

const LABELS: Record<SetupStop["key"], string> = {
  created: "Created",
  connected: "Connected",
  company: "Company",
  configured: "Configured",
  dryrun: "Dry run",
  live: "Live",
};

const ORDER: SetupStop["key"][] = ["created", "connected", "company", "configured", "dryrun", "live"];

export function missingConfiguration(t: SetupTenant): string[] {
  const missing: string[] = [];
  if (t.vatTypeId === null) missing.push("VAT type");
  if (t.paymentAccountId === null) missing.push("payment account");
  if (t.paymentMethodId === null) missing.push("payment method");
  if (t.fiscalRegime === "FORFETTARIO" && t.stampDutyMode === "CHARGED_TO_CUSTOMER" && t.stampDutyVatTypeId === null) {
    missing.push("stamp duty VAT type");
  }
  return missing;
}

/** Where a tenant stands on its way from created to live. Derived only from stored fields. */
export function setupProgress(t: SetupTenant): SetupProgress {
  const base = `/admin/tenants/${t.id}`;
  const hasToken = Boolean(t.accessTokenEnc);
  const connected = hasToken && !t.ficNeedsReconnect;
  const company = connected && t.ficCompanyId !== null;
  const configured = company && missingConfiguration(t).length === 0;
  const live = configured && !t.dryRun;

  const flags = [true, connected, company, configured, configured, live];
  let reached = 0;
  while (reached + 1 < flags.length && flags[reached + 1]) reached += 1;

  const problemAt = t.ficNeedsReconnect ? 1 : -1;

  const stops: SetupStop[] = ORDER.map((key, i) => ({
    key,
    label: LABELS[key],
    state: i === problemAt ? "problem" : i < reached ? "done" : i === reached ? "current" : "todo",
  }));

  let next: SetupProgress["next"] = null;
  if (t.ficNeedsReconnect) next = { label: "Reconnect Fatture in Cloud", href: `${base}#connection`, problem: true };
  else if (!hasToken) next = { label: "Connect Fatture in Cloud", href: `${base}#connection`, problem: false };
  else if (!company) next = { label: "Choose the company", href: `${base}/company`, problem: false };
  else if (!configured) next = { label: "Finish the invoice settings", href: `${base}#configuration`, problem: false };
  else if (!live) next = { label: "Test, then turn off dry run", href: `${base}#going-live`, problem: false };

  return { stops, reached, live, next };
}

export function SetupLine({ progress, big = false }: { progress: SetupProgress; big?: boolean }) {
  const { stops, reached, live } = progress;
  const current = stops.find((s) => s.state === "problem") ?? stops[reached];
  return (
    <ol
      className={`line${live ? " live" : ""}${big ? " big" : ""}`}
      style={{ "--progress": reached / (stops.length - 1) } as React.CSSProperties}
      aria-label={`Setup: ${current.state === "problem" ? `problem at ${current.label}` : `at ${current.label}`}`}
    >
      {stops.map((s) => (
        <li key={s.key} className={`stop ${s.state}`} aria-current={s === current ? "step" : undefined}>
          <span className="stop-dot" aria-hidden="true" />
          <span className="stop-label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
