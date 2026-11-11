/**
 * Runs once when the server starts. Starts the periodic App Store check, so self-hosted instances
 * need no external cron. Disable with APPSTORE_POLL=false (for example with several app processes).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (["0", "false", "no", "off"].includes((process.env.APPSTORE_POLL ?? "").toLowerCase())) return;

  const { checkAllAccounts } = await import("./lib/appstore/check");
  const run = () => {
    checkAllAccounts().catch((error) => console.error("[fic-invoicing] App Store check failed", error));
  };
  // First check shortly after start, then every 6 hours.
  setTimeout(run, 60_000).unref();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}
