import { Alert, Check, Info } from "./icons";

const NOTICES: Record<string, string> = {
  saved: "Configuration saved.",
  connected: "Fatture in Cloud connected.",
  disconnected: "Fatture in Cloud disconnected.",
  retried: "Invoice retried.",
  deleted: "Invoice deleted. The row is kept with status Deleted, under the Deleted tab.",
  retry_failed: "The retry reached Fatture in Cloud, which returned an error: see the invoice row.",
};

const ERRORS: Record<string, string> = {
  invalid_oauth_state: "The authorization link expired or is invalid. Start the connection again.",
  unknown_tenant: "Unknown tenant.",
  oauth_callback_failed: "Could not complete the Fatture in Cloud authorization. Check the server logs.",
  unknown_company: "Pick one of the listed companies.",
};

export function Notice({
  tone = "info",
  children,
  className = "",
}: {
  tone?: "info" | "ok" | "error" | "warn";
  children: React.ReactNode;
  className?: string;
}) {
  const icon = tone === "ok" ? <Check /> : tone === "info" ? <Info /> : <Alert />;
  return (
    <div className={`notice ${tone} ${className}`} role={tone === "error" ? "alert" : "status"}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function Notices({ notice, error }: { notice?: string; error?: string }) {
  return (
    <>
      {notice && <Notice tone={notice === "retry_failed" ? "warn" : "ok"}>{NOTICES[notice] ?? notice}</Notice>}
      {error && <Notice tone="error">{ERRORS[error] ?? error}</Notice>}
    </>
  );
}
