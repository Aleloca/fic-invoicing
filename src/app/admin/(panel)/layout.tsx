import Link from "next/link";
import { requireAdmin } from "@/lib/admin-session";
import { logoutAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireAdmin();
  return (
    <>
      <header className="topbar">
        <Link href="/admin">fic-invoicing</Link>
        <form action={logoutAction}>
          <button type="submit" className="secondary">
            Sign out
          </button>
        </form>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
