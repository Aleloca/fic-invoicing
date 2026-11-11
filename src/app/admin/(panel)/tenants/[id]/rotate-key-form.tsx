"use client";

import { useActionState } from "react";
import { rotateApiKeyAction, type FormState } from "../../../actions";
import { ApiKeyReveal } from "@/components/api-key-reveal";

export function RotateKeyForm({ tenantId, prefix }: { tenantId: string; prefix: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(rotateApiKeyAction, {});
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!confirm("Rotate the API key? The current key stops working immediately.")) event.preventDefault();
      }}
    >
      <input type="hidden" name="tenantId" value={tenantId} />
      {state.error && <p className="notice error">{state.error}</p>}
      {state.apiKey ? (
        <ApiKeyReveal apiKey={state.apiKey} />
      ) : (
        <p className="muted small">
          Current key starts with <code>{prefix}…</code>
        </p>
      )}
      <button type="submit" className="danger" disabled={pending}>
        {pending ? "Rotating…" : "Rotate API key"}
      </button>
    </form>
  );
}
