import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { factorState } from "@/lib/admin-security";
import { hasPendingSession, isAdmin } from "@/lib/admin-session";
import { BrandMark } from "@/components/brand";
import { VerifyForm } from "./verify-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm sign-in" };

export default async function VerifyPage() {
  if (await isAdmin()) redirect("/admin");
  if (!(await hasPendingSession())) redirect("/admin/login");
  const state = await factorState();
  if (!state.enabled) redirect("/admin/login");
  return (
    <div className="login">
      <div className="login-brand">
        <Link href="/" className="name">
          <BrandMark size={64} className="login-mark" />
          fic-
          <br />
          invoicing
        </Link>
        <p>Italian e-invoices through Fatture in Cloud, for every app on this instance.</p>
      </div>
      <main className="login-form">
        <VerifyForm passkeys={state.passkeys > 0} totp={state.totp} />
      </main>
    </div>
  );
}
