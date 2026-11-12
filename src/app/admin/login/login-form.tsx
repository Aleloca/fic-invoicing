"use client";

import { useActionState } from "react";
import { loginAction, type FormState } from "../actions";
import { Notice } from "@/components/notices";
import { SubmitButton } from "@/components/submit-button";

export function LoginForm() {
  const [state, action] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action}>
      <h1>Sign in</h1>
      {state.error && (
        <Notice tone="error" className="inline">
          {state.error}
        </Notice>
      )}
      <div className="field">
        <label htmlFor="password">Admin password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
      </div>
      <SubmitButton className="btn" pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
