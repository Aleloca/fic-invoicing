import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "fic-invoicing",
    short_name: "fic-invoicing",
    description: "Italian e-invoices through Fatture in Cloud, for several apps at once.",
    start_url: "/admin",
    display: "standalone",
    theme_color: "#e3001b",
    background_color: "#111111",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
