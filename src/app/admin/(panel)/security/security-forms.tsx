"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { CopyButton } from "@/components/copy-button";
import { Notice } from "@/components/notices";
import {
  cancelTotpAction,
  confirmTotpAction,
  disableTotpAction,
  passkeyRegisterOptionsAction,
  passkeyRegisterVerifyAction,
  regenerateRecoveryAction,
  startTotpAction,
  type SecurityState,
} from "../../security-actions";

/** Recovery codes shown once, right after they are made. */
function CodesReveal({ codes }: { codes: string[] }) {
  return (
    <div className="key-reveal">
      <h3>Save these recovery codes</h3>
      <p className="hint">
        They are shown only now. Keep them in a password manager or on paper: each one signs in once, when you have
        neither the passkey nor the authenticator app.
      </p>
      <ol className="recovery-codes mono">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="btn-row">
        <CopyButton text={codes.join("\n")} label="Copy codes" variant="button" />
      </div>
    </div>
  );
}

/**
 * The authenticator app section. A client component at a stable place, so the recovery codes made
 * on confirmation survive the refresh that follows.
 */
export function TotpSection({
  enabled,
  lastFactor,
  setup,
}: {
  enabled: boolean;
  lastFactor: boolean;
  setup: { qr: string; secret: string } | null;
}) {
  const [state, action, pending] = useActionState<SecurityState, FormData>(confirmTotpAction, {});
  const justEnabled = state.done && enabled;

  if (enabled) {
    return (
      <>
        {justEnabled &&
          (state.recoveryCodes ? <CodesReveal codes={state.recoveryCodes} /> : <Notice tone="ok">Authenticator app on.</Notice>)}
        {!justEnabled && <p>The authenticator app is on.</p>}
        <details className="confirm">
          <summary className="btn small danger">Remove</summary>
          <div className="confirm-box">
            <p>
              {lastFactor ? "This is the last second factor: two-factor sign-in turns off." : "Codes from the app will no longer sign in."}
            </p>
            <form action={disableTotpAction}>
              <button type="submit" className="btn small danger solid">
                Remove authenticator app
              </button>
            </form>
          </div>
        </details>
      </>
    );
  }

  if (setup) {
    return (
      <div className="totp-setup">
        <div className="qr" dangerouslySetInnerHTML={{ __html: setup.qr }} />
        <div className="totp-steps">
          <p>Scan the code with the app, then type the code it shows to confirm.</p>
          <p className="hint">
            Cannot scan? Enter this key by hand: <code className="mono">{setup.secret}</code>
          </p>
          {state.error && (
            <Notice tone="error" className="inline">
              {state.error}
            </Notice>
          )}
          <form action={action} className="rename-form">
            <input
              type="text"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              aria-label="Code from the app"
              placeholder="123456"
              required
            />
            <button type="submit" className="btn" disabled={pending}>
              {pending ? "Checking…" : "Confirm"}
            </button>
          </form>
          <form action={cancelTotpAction}>
            <button type="submit" className="link-button">
              Cancel
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <form action={startTotpAction}>
      <button type="submit" className="btn secondary">
        Set up authenticator app
      </button>
    </form>
  );
}

export function AddPasskey({ suggestedName }: { suggestedName: string }) {
  const router = useRouter();
  const [name, setName] = useState(suggestedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [added, setAdded] = useState(false);

  async function add() {
    setError(null);
    setAdded(false);
    setBusy(true);
    try {
      const options = await passkeyRegisterOptionsAction();
      const response = await startRegistration({ optionsJSON: options });
      const result = await passkeyRegisterVerifyAction(response, name);
      if (result.error) setError(result.error);
      else {
        setAdded(true);
        if (result.recoveryCodes) setCodes(result.recoveryCodes);
        router.refresh();
      }
    } catch (e) {
      const errorName = e instanceof Error ? e.name : "";
      setError(
        errorName === "InvalidStateError"
          ? "This device already has a passkey for this panel."
          : errorName === "NotAllowedError"
            ? "The passkey request was cancelled or timed out."
            : "This browser could not create the passkey.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && (
        <Notice tone="error" className="inline">
          {error}
        </Notice>
      )}
      {added && !codes && <Notice tone="ok">Passkey added.</Notice>}
      {codes && <CodesReveal codes={codes} />}
      <div className="rename-form">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name of the new passkey" maxLength={80} />
        <button type="button" className="btn secondary" onClick={add} disabled={busy}>
          {busy ? "Waiting for the device…" : "Add a passkey"}
        </button>
      </div>
    </>
  );
}

export function RecoveryCodes() {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pending, start] = useTransition();
  if (codes) return <CodesReveal codes={codes} />;
  return (
    <details className="confirm">
      <summary className="btn small secondary">Generate new codes</summary>
      <div className="confirm-box">
        <p>The current codes stop working.</p>
        <button
          type="button"
          className="btn small"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await regenerateRecoveryAction();
              if (result.recoveryCodes) setCodes(result.recoveryCodes);
            })
          }
        >
          Generate
        </button>
      </div>
    </details>
  );
}
