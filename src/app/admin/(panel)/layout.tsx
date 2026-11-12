import Link from "next/link";
import { AdminNav } from "@/components/admin-nav";
import { BrandMark } from "@/components/brand";
import { requireAdmin } from "@/lib/admin-session";
import { logoutAction } from "../actions";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireAdmin();
  return (
    <div className="shell">
      <header className="rail">
        <Link href="/admin" className="rail-brand">
          <BrandMark size={30} />
          fic-invoicing
        </Link>
        <AdminNav />
        <form action={logoutAction} className="rail-foot">
          <SubmitButton>Sign out</SubmitButton>
        </form>
      </header>
      <main className="workspace">{children}</main>
    </div>
  );
}
