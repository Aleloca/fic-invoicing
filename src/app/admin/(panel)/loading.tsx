/** Shown in the workspace while the next admin page loads. */
export default function Loading() {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="route-progress" aria-hidden="true" />
      <span className="spinner" aria-hidden="true" />
      Loading…
    </div>
  );
}
