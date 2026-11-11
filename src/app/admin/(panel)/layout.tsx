import Link from "next/link";
import { AdminNav } from "@/components/admin-nav";
import { requireAdmin } from "@/lib/admin-session";
import { logoutAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireAdmin();
  return (
    <div className="shell">
      <header className="rail">
        <Link href="/admin" className="rail-brand">
          fic-invoicing
        </Link>
        <AdminNav />
        <form action={logoutAction} className="rail-foot">
          <button type="submit">Sign out</button>
        </form>
      </header>
      <main className="workspace">{children}</main>
    </div>
  );
}
