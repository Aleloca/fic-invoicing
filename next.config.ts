import type { NextConfig } from "next";

/**
 * SITE_BUILD=github exports only the public home page as a static site for GitHub Pages
 * (https://aleloca.github.io/fic-invoicing/): only `*.site.tsx` files are routes in that build,
 * so the admin and the API are left out. See .github/workflows/pages.yml.
 */
const githubPages: NextConfig = {
  output: "export",
  basePath: "/fic-invoicing",
  pageExtensions: ["site.tsx", "site.ts"],
  trailingSlash: true,
  poweredByHeader: false,
};

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async redirects() {
    // Projects used to be called tenants.
    return [
      { source: "/admin/tenants", destination: "/admin", permanent: true },
      { source: "/admin/tenants/:path*", destination: "/admin/projects/:path*", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default process.env.SITE_BUILD === "github" ? githubPages : nextConfig;
