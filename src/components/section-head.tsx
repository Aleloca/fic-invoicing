/** Left column of a settings section: optional step number, title and a short explanation. */
export function SectionHead({
  step,
  done,
  title,
  children,
}: {
  step?: number;
  done?: boolean;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="section-head">
      {step !== undefined && (
        <span className={`step${done ? " done" : ""}`} aria-hidden="true">
          {step}
        </span>
      )}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}
