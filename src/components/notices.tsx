import { Alert, Check, Info } from "./icons";

const NOTICES: Record<string, string> = {
  saved: "Settings saved.",
  connected: "Company connected. The project now uses its settings.",
  account_connected: "Fatture in Cloud account connected.",
  reconnected: "Fatture in Cloud account reconnected. Every project using it can issue invoices again.",
  disconnected: "Fatture in Cloud account disconnected. Its projects cannot issue invoices until it is reconnected.",
  account_removed: "Fatture in Cloud account removed.",
  company_removed: "Company removed.",
  appstore_connected: "App Store Connect set up. The key works; new reports will show up here.",
  appstore_saved: "App Store settings saved.",
  appstore_found: "New App Store report found: check the amount and issue the invoice.",
  appstore_nothing_new: "No new App Store report yet.",
  appstore_issued: "Invoice to Apple issued.",
  appstore_failed: "Fatture in Cloud refused the invoice to Apple: see the error below, fix it and retry from the invoices.",
  appstore_dismissed: "Report marked as invoiced elsewhere.",
  appstore_restored: "Report ready to invoice again.",
  appstore_removed: "App Store settings removed. Invoices already issued are kept.",
  retried: "Invoice retried.",
  deleted: "Invoice deleted. The row is kept with status Deleted, under the Deleted tab.",
  retry_failed: "The retry reached Fatture in Cloud, which returned an error: see the invoice row.",
};

const ERRORS: Record<string, string> = {
  invalid_oauth_state: "The authorization link expired or is invalid. Start the connection again.",
  unknown_project: "Unknown project.",
  oauth_unknown_account: "That Fatture in Cloud account no longer exists here. Connect it again as a new account.",
  oauth_different_user:
    "You authorized a different Fatture in Cloud user from the one of this account. Reconnect with the same user, or connect the other user as a new account.",
  account_in_use: "This account still has companies used by projects. Move those projects to another company first.",
  company_in_use: "This company is still used by projects. Move them to another company first.",
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
      {notice && <Notice tone={notice === "retry_failed" || notice === "appstore_failed" ? "warn" : "ok"}>{NOTICES[notice] ?? notice}</Notice>}
      {error && <Notice tone="error">{ERRORS[error] ?? error}</Notice>}
    </>
  );
}
