import type { Metadata } from "next";
import Link from "next/link";
import { AppleSettingsForm } from "@/components/apple-settings-form";
import { ArrowLeft } from "@/components/icons";
import { Notices } from "@/components/notices";
import { companyChoices } from "@/lib/appstore/companies";

export const metadata: Metadata = { title: "Connect an Apple account" };

export default async function NewAppleAccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <Link href="/admin/apple" className="crumb">
        <ArrowLeft />
        Apple
      </Link>
      <div className="page-head">
        <h1>Connect an Apple account</h1>
        <p className="sub">
          The App Store Connect account Apple pays. Its apps can belong to different projects: you assign them when they
          first appear in a report.
        </p>
      </div>
      <Notices error={error} />
      <AppleSettingsForm account={null} companies={await companyChoices()} lookups={{ vatTypes: null, paymentAccounts: null, paymentMethods: null, error: null }} />
    </>
  );
}
