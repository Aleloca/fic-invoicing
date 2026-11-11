import { connectionState, missingConfiguration, resolveConfig, type ProjectWithCompany } from "@/lib/projects/config";

type StopState = "done" | "current" | "problem" | "todo";

export interface SetupStop {
  key: "created" | "company" | "connected" | "configured" | "dryrun" | "live";
  label: string;
  state: StopState;
}

export interface SetupProgress {
  stops: SetupStop[];
  /** Index of the furthest stop reached (0 = created). */
  reached: number;
  live: boolean;
  /** What the operator should do next, or null when the project is live and healthy. */
  next: { label: string; href: string; problem: boolean } | null;
}

const LABELS: Record<SetupStop["key"], string> = {
  created: "Created",
  company: "Company",
  connected: "Connected",
  configured: "Configured",
  dryrun: "Dry run",
  live: "Live",
};

const ORDER: SetupStop["key"][] = ["created", "company", "connected", "configured", "dryrun", "live"];

/** Where a project stands on its way from created to live. Derived only from stored fields. */
export function setupProgress(p: ProjectWithCompany): SetupProgress {
  const base = `/admin/projects/${p.id}`;
  const state = connectionState(p);
  const company = state !== "no_company";
  const connected = state === "ready";
  const configured = connected && missingConfiguration(resolveConfig(p.company, p).invoice).length === 0;
  const live = configured && !p.dryRun;

  const flags = [true, company, connected, configured, configured, live];
  let reached = 0;
  while (reached + 1 < flags.length && flags[reached + 1]) reached += 1;

  const problemAt = state === "reconnect" ? 2 : -1;

  const stops: SetupStop[] = ORDER.map((key, i) => ({
    key,
    label: LABELS[key],
    state: i === problemAt ? "problem" : i < reached ? "done" : i === reached ? "current" : "todo",
  }));

  let next: SetupProgress["next"] = null;
  if (!company) next = { label: "Choose the company", href: `${base}/company`, problem: false };
  else if (state === "reconnect") next = { label: "Reconnect Fatture in Cloud", href: `${base}#connection`, problem: true };
  else if (state === "not_connected") next = { label: "Connect Fatture in Cloud", href: `${base}#connection`, problem: false };
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
