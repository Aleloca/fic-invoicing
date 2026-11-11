"use client";

import { useActionState } from "react";
import { loginAction, type FormState } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action}>
      {state.error && <p className="notice error">{state.error}</p>}
      <label htmlFor="password">Admin password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
      <p>
        <button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </p>
    </form>
  );
}
