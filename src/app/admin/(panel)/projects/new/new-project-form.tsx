"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createProjectAction, type FormState } from "../../../actions";
import { ApiKeyReveal } from "@/components/api-key-reveal";
import { ArrowRight } from "@/components/icons";
import { Notice } from "@/components/notices";

export function NewProjectForm({ companies }: { companies: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createProjectAction, {});

  if (state.apiKey && state.projectId) {
    return (
      <div className="section-body">
        <ApiKeyReveal apiKey={state.apiKey} />
        <div className="btn-row">
          <Link className="btn" href={`/admin/projects/${state.projectId}`}>
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
      {companies.length > 0 && (
        <div className="field">
          <label htmlFor="companyId">Company</label>
          <select
            id="companyId"
            name="companyId"
            defaultValue={companies.length === 1 ? companies[0].id : ""}
            aria-describedby="companyId-hint"
          >
            <option value="">Choose later</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="hint" id="companyId-hint">
            A company already set up here: the project uses its settings, no new Fatture in Cloud login. To use another
            company or account, choose later from the project.
          </span>
        </div>
      )}
      <div className="form-foot">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Creating…" : "Create project"}
        </button>
      </div>
    </form>
  );
}
