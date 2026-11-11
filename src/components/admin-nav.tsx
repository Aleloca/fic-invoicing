"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Tenants", match: (p: string) => p === "/admin" || p.startsWith("/admin/tenants") },
  { href: "/admin/invoices", label: "Invoices", match: (p: string) => p.startsWith("/admin/invoices") },
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
      <Link href="/#api" className="rail-link">
        API reference
      </Link>
    </nav>
  );
}
