// GitHub Pages build only (SITE_BUILD=github, see next.config.ts): same layout, but indexable,
// since this copy exists to present the project.
import type { Metadata } from "next";
import { metadata as instanceMetadata } from "./layout";

export { default, viewport } from "./layout";

export const metadata: Metadata = {
  ...instanceMetadata,
  metadataBase: new URL("https://aleloca.github.io/fic-invoicing/"),
  title: "fic-invoicing · Italian e-invoices through Fatture in Cloud",
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: {
    title: "fic-invoicing",
    description: instanceMetadata.description ?? undefined,
    url: "/",
    type: "website",
  },
};
