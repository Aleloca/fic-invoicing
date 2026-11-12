import type { Metadata } from "next";
import QRCode from "qrcode";
import { Notices } from "@/components/notices";
import { SectionHead } from "@/components/section-head";
import { factorState, pendingTotp } from "@/lib/admin-security";
import { dateTime } from "@/lib/format";
import { relyingParty } from "@/lib/passkeys";
import { prisma } from "@/lib/prisma";
import { removePasskeyAction, renamePasskeyAction } from "../../security-actions";
import { AddPasskey, RecoveryCodes, TotpSection } from "./security-forms";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const [state, pending, passkeys] = await Promise.all([
    factorState(),
    pendingTotp(),
    prisma.adminPasskey.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  const qr = pending ? await QRCode.toString(pending.uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : null;
  const host = relyingParty().rpID;

  return (
    <>
      <div className="page-head">
        <h1>Security</h1>
        <p className="sub">
          {state.enabled
            ? "Two-factor sign-in is on: after the password, every sign-in asks for a passkey or a code from the authenticator app."
            : "Two-factor sign-in is off: the password alone opens the panel. Add a passkey or an authenticator app to turn it on."}
        </p>
      </div>
      <Notices notice={notice} />

      <section className="section">
        <SectionHead title="Passkeys" done={passkeys.length > 0}>
          Face ID, Touch ID, Windows Hello or a security key. They work only on {host}.
        </SectionHead>
        <div className="section-body">
          {passkeys.length > 0 && (
            <ul className="factor-list">
              {passkeys.map((p) => (
                <li key={p.id} className="factor-row">
                  <form action={renamePasskeyAction} className="rename-form">
                    <input type="hidden" name="id" value={p.id} />
                    <input type="text" name="name" defaultValue={p.name} aria-label="Passkey name" maxLength={80} required />
                    <button type="submit" className="btn small secondary">
                      Rename
                    </button>
                  </form>
                  <span className="hint">
                    Added {dateTime(p.createdAt)}
                    {p.lastUsedAt ? ` · last used ${dateTime(p.lastUsedAt)}` : " · never used"}
                  </span>
                  <details className="confirm">
                    <summary className="btn small danger">Remove</summary>
                    <div className="confirm-box">
                      <p>
                        {passkeys.length === 1 && !state.totp
                          ? "This is the last second factor: two-factor sign-in turns off."
                          : "This passkey will no longer sign in."}
                      </p>
                      <form action={removePasskeyAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <button type="submit" className="btn small danger solid">
                          Remove passkey
                        </button>
                      </form>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <AddPasskey suggestedName={passkeys.length === 0 ? "This device" : `Passkey ${passkeys.length + 1}`} />
        </div>
      </section>

      <section className="section">
        <SectionHead title="Authenticator app" done={state.totp}>
          A 6-digit code from 1Password, Google Authenticator, Authy or any app that supports TOTP.
        </SectionHead>
        <div className="section-body">
          <TotpSection
            enabled={state.totp}
            lastFactor={state.passkeys === 0}
            setup={pending && qr ? { qr, secret: pending.secret.replace(/(.{4})/g, "$1 ").trim() } : null}
          />
        </div>
      </section>

      {state.enabled && (
        <section className="section">
          <SectionHead title="Recovery codes">
            For when you have neither the passkey nor the phone. Each code works once.
          </SectionHead>
          <div className="section-body">
            <p>
              <strong>{state.recoveryLeft}</strong> of 10 codes left.
            </p>
            <RecoveryCodes />
          </div>
        </section>
      )}
    </>
  );
}
