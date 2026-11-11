import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "@/components/icons";
import { prisma } from "@/lib/prisma";
import { NewProjectForm } from "./new-project-form";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage() {
  const companies = await prisma.company.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, account: { select: { label: true } } },
  });
  return (
    <div style={{ maxWidth: 640 }}>
      <Link href="/admin" className="crumb">
        <ArrowLeft />
        Projects
      </Link>
      <div className="page-head">
        <h1>New project</h1>
        <p className="sub">
          One project per app. You get its API key once. It invoices from a Fatture in Cloud company and starts with
          that company&apos;s settings.
        </p>
      </div>
      <NewProjectForm companies={companies.map((c) => ({ id: c.id, label: `${c.name} · ${c.account.label}` }))} />
    </div>
  );
}
