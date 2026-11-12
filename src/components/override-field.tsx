"use client";

import { useState } from "react";

/**
 * A project setting that either follows its company or is customized for this project.
 * While it follows the company the control is not rendered, so nothing is submitted for it and
 * the server stores null (inherit). Ticking "Custom" shows the control, prefilled.
 */
export function OverrideField({
  name,
  label,
  inherited,
  custom: initiallyCustom,
  hint,
  wide = false,
  only,
  children,
}: {
  name: string;
  label: string;
  /** The company value, in words. */
  inherited: React.ReactNode;
  custom: boolean;
  hint?: React.ReactNode;
  wide?: boolean;
  /** Shown only under this fiscal regime. */
  only?: "FORFETTARIO" | "ORDINARIO";
  children: React.ReactNode;
}) {
  const [custom, setCustom] = useState(initiallyCustom);
  const hintId = hint ? `${name}-hint` : undefined;
  return (
    <div className={`field override${custom ? " is-custom" : ""}${wide ? " wide" : ""}`} data-only={only}>
      <div className="override-head">
        {custom ? <label htmlFor={name}>{label}</label> : <span className="label">{label}</span>}
        <label className="override-switch">
          <input
            type="checkbox"
            name={`custom_${name}`}
            checked={custom}
            onChange={(event) => setCustom(event.target.checked)}
            aria-label={`Customize ${label} for this project`}
          />
          Custom
        </label>
      </div>
      {custom ? (
        children
      ) : (
        <p className="inherited">
          <span className="inherited-value">{inherited}</span>
          <span className="inherited-from">Company default</span>
        </p>
      )}
      {hint && (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      )}
    </div>
  );
}
