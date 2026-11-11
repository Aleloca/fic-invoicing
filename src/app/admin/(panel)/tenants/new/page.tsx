import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "@/components/icons";
import { NewTenantForm } from "./new-tenant-form";

export const metadata: Metadata = { title: "New tenant" };

export default function NewTenantPage() {
  return (
    <div style={{ maxWidth: 640 }}>
      <Link href="/admin" className="crumb">
        <ArrowLeft />
        Tenants
      </Link>
      <div className="page-head">
        <h1>New tenant</h1>
        <p className="sub">
          One tenant per app. After creating it you get the API key once, then connect a Fatture in Cloud company.
        </p>
      </div>
      <NewTenantForm />
    </div>
  );
}
