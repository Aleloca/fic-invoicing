"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createTenantAction, type FormState } from "../../../actions";
import { ApiKeyReveal } from "@/components/api-key-reveal";

export function NewTenantForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createTenantAction, {});

  if (state.apiKey && state.tenantId) {
    return (
      <>
        <ApiKeyReveal apiKey={state.apiKey} />
        <Link className="button" href={`/admin/tenants/${state.tenantId}`}>
          Continue to tenant setup
        </Link>
      </>
    );
  }

  return (
    <form action={action}>
      {state.error && <p className="notice error">{state.error}</p>}
      <p>
        <label htmlFor="name">Name</label>
        <input id="name" name="name" type="text" required maxLength={100} placeholder="My shop" />
      </p>
      <p>
        <label htmlFor="slug">
          Slug <span className="hint">Optional. Defaults to the name in kebab-case.</span>
        </label>
        <input id="slug" name="slug" type="text" maxLength={60} placeholder="my-shop" />
      </p>
      <button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create tenant"}
      </button>
    </form>
  );
}
