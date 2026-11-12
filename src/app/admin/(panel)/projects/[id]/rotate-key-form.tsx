"use client";

import { useActionState } from "react";
import { rotateApiKeyAction, type FormState } from "../../../actions";
import { ApiKeyReveal } from "@/components/api-key-reveal";
import { Notice } from "@/components/notices";
import { SubmitButton } from "@/components/submit-button";

export function RotateKeyForm({ projectId, prefix }: { projectId: string; prefix: string }) {
  const [state, action] = useActionState<FormState, FormData>(rotateApiKeyAction, {});
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!confirm("Rotate the API key? The current key stops working immediately.")) event.preventDefault();
      }}
      className="section-body"
    >
      <input type="hidden" name="projectId" value={projectId} />
      {state.error && (
        <Notice tone="error" className="inline">
          {state.error}
        </Notice>
      )}
      {state.apiKey ? (
        <ApiKeyReveal apiKey={state.apiKey} />
      ) : (
        <p>
          The current key starts with <code>{prefix}…</code>
        </p>
      )}
      <div className="btn-row">
        <SubmitButton className="btn danger" pendingLabel="Rotating…">Rotate API key</SubmitButton>
      </div>
    </form>
  );
}
