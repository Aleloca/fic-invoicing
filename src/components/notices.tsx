const NOTICES: Record<string, string> = {
  saved: "Configuration saved.",
  connected: "Fatture in Cloud connected.",
  disconnected: "Fatture in Cloud disconnected.",
  retried: "Invoice retried.",
  deleted: "Invoice deleted from Fatture in Cloud. The row is kept with status DELETED.",
  retry_failed: "The retry was attempted but Fatture in Cloud returned an error: see the invoice row.",
};

const ERRORS: Record<string, string> = {
  invalid_oauth_state: "The OAuth state is invalid or expired. Start the connection again.",
  unknown_tenant: "Unknown tenant.",
  oauth_callback_failed: "Could not complete the Fatture in Cloud authorization. Check the server logs.",
  unknown_company: "Pick one of the listed companies.",
};

export function Notices({ notice, error }: { notice?: string; error?: string }) {
  return (
    <>
      {notice && <p className="notice ok">{NOTICES[notice] ?? notice}</p>}
      {error && <p className="notice error">{ERRORS[error] ?? error}</p>}
    </>
  );
}
