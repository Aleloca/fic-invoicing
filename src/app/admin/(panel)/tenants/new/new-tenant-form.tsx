"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createTenantAction, type FormState } from "../../../actions";
import { ApiKeyReveal } from "@/components/api-key-reveal";
import { ArrowRight } from "@/components/icons";
import { Notice } from "@/components/notices";

export function NewTenantForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createTenantAction, {});

  if (state.apiKey && state.tenantId) {
    return (
      <div className="section-body">
        <ApiKeyReveal apiKey={state.apiKey} />
        <div className="btn-row">
          <Link className="btn" href={`/admin/tenants/${state.tenantId}`}>
            I copied it, continue setup
            <ArrowRight />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="section-body" style={{ borderTop: "2px solid var(--rule)", paddingTop: 28 }}>
      {state.error && (
        <Notice tone="error" className="inline">
          {state.error}
        </Notice>
      )}
      <div className="field">
        <label htmlFor="name">Name</label>
        <input id="name" name="name" type="text" required maxLength={100} placeholder="My shop" />
      </div>
      <div className="field">
        <label htmlFor="slug">Slug</label>
        <input id="slug" name="slug" type="text" maxLength={60} placeholder="my-shop" aria-describedby="slug-hint" />
        <span className="hint" id="slug-hint">
          Optional. Defaults to the name in kebab-case.
        </span>
      </div>
      <div className="form-foot">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Creating…" : "Create tenant"}
        </button>
      </div>
    </form>
  );
}
