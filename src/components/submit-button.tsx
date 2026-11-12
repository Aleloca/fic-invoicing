"use client";

import { useId } from "react";
import { useFormStatus } from "react-dom";

/**
 * A submit button for server-action forms. While the form is submitting every button of the form
 * is disabled, and the one that was pressed shows a spinner (and `pendingLabel`, if given).
 * The pressed button is told apart by its value in the submitted form data.
 */
export function SubmitButton({
  children,
  className,
  pendingLabel,
  formAction,
  formNoValidate,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: React.ReactNode;
  formAction?: (formData: FormData) => void | Promise<void>;
  formNoValidate?: boolean;
}) {
  const id = useId();
  const { pending, data } = useFormStatus();
  const busy = pending && data?.get("_submitter") === id;
  return (
    <button
      type="submit"
      name="_submitter"
      value={id}
      className={[className, busy ? "is-busy" : ""].filter(Boolean).join(" ") || undefined}
      disabled={pending}
      aria-busy={busy || undefined}
      formAction={formAction}
      formNoValidate={formNoValidate}
    >
      {busy && <span className="spinner" aria-hidden="true" />}
      {busy && pendingLabel ? pendingLabel : children}
    </button>
  );
}
