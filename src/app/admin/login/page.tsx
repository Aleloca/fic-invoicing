import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-session";
import { BrandMark } from "@/components/brand";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await isAdmin()) redirect("/admin");
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
        <LoginForm />
      </main>
    </div>
  );
}
