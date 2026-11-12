/**
 * Runs once when the server starts.
 * - Every 5 minutes, releases invoices left PENDING by a process that stopped mid-call.
 * - Starts the periodic App Store check, so self-hosted instances need no external cron.
 *   Disable it with APPSTORE_POLL=false (for example with several app processes).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { recoverStalePending } = await import("./lib/invoices/service");
  setInterval(() => {
    recoverStalePending().catch((error) => console.error("[fic-invoicing] could not release stale invoices", error));
  }, 5 * 60 * 1000).unref();

  if (["0", "false", "no", "off"].includes((process.env.APPSTORE_POLL ?? "").toLowerCase())) return;

  const { checkAllAccounts } = await import("./lib/appstore/check");
  const run = () => {
    checkAllAccounts().catch((error) => console.error("[fic-invoicing] App Store check failed", error));
  };
  // First check shortly after start, then every 6 hours.
  setTimeout(run, 60_000).unref();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}
