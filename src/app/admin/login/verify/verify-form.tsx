"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Notice } from "@/components/notices";
import { passkeyLoginOptionsAction, passkeyLoginVerifyAction, verifyCodeAction, type VerifyState } from "../../security-actions";
import { SubmitButton } from "@/components/submit-button";

export function VerifyForm({ passkeys, totp }: { passkeys: boolean; totp: boolean }) {
  const router = useRouter();
  const [state, action] = useActionState<VerifyState, FormData>(verifyCodeAction, {});
  const [method, setMethod] = useState<"totp" | "recovery">(totp ? "totp" : "recovery");
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  async function signInWithPasskey() {
    setPasskeyError(null);
    setPasskeyBusy(true);
    try {
      const options = await passkeyLoginOptionsAction();
      if (!options) {
        router.push("/admin/login");
        return;
      }
      const response = await startAuthentication({ optionsJSON: options });
      const result = await passkeyLoginVerifyAction(response);
      if (result.error) setPasskeyError(result.error);
      else {
        router.push("/admin");
        router.refresh();
      }
    } catch (error) {
      // NotAllowedError: the person closed the prompt or it timed out.
      setPasskeyError(
        error instanceof Error && error.name === "NotAllowedError"
          ? "The passkey request was cancelled or timed out."
          : "This browser could not use the passkey.",
      );
    } finally {
      setPasskeyBusy(false);
    }
  }

  const error = state.error ?? passkeyError;
  return (
    <form action={action}>
      <h1>Confirm it is you</h1>
      <p className="hint">The password is right. Now confirm with your second factor.</p>
      {error && (
        <Notice tone="error" className="inline">
          {error}
        </Notice>
      )}
      {passkeys && (
        <button type="button" className="btn" onClick={signInWithPasskey} disabled={passkeyBusy}>
          {passkeyBusy ? "Waiting for the passkey…" : "Use a passkey"}
        </button>
      )}
      <input type="hidden" name="method" value={method} />
      {method === "totp" ? (
        <div className="field">
          <label htmlFor="code">Code from the authenticator app</label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            required
            autoFocus={!passkeys}
          />
        </div>
      ) : (
        <div className="field">
          <label htmlFor="code">Recovery code</label>
          <input id="code" name="code" type="text" autoComplete="off" spellCheck={false} required autoFocus />
          <span className="hint">One of the codes you saved when you turned on two-factor sign-in. Each works once.</span>
        </div>
      )}
      <SubmitButton className={passkeys ? "btn secondary" : "btn"} pendingLabel="Checking…">Confirm</SubmitButton>
      <div className="btn-row">
        {totp && (
          <button type="button" className="link-button" onClick={() => setMethod(method === "totp" ? "recovery" : "totp")}>
            {method === "totp" ? "Use a recovery code" : "Use the authenticator app"}
          </button>
        )}
        <Link href="/admin/login" className="link-button">
          Start over
        </Link>
      </div>
    </form>
  );
}
