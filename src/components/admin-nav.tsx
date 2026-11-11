"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Projects", match: (p: string) => p === "/admin" || p.startsWith("/admin/projects") },
  { href: "/admin/invoices", label: "Invoices", match: (p: string) => p.startsWith("/admin/invoices") },
  {
    href: "/admin/fic",
    label: "Fatture in Cloud",
    match: (p: string) => p.startsWith("/admin/fic") || p.startsWith("/admin/companies"),
  },
  { href: "/admin/api", label: "API reference", match: (p: string) => p.startsWith("/admin/api") },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="rail-nav" aria-label="Admin">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="rail-link" aria-current={l.match(pathname) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
