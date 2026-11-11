// GitHub Pages build only (SITE_BUILD=github, see next.config.ts): the home page without admin links.
import { HomePage } from "@/components/home-page";

export default function Home() {
  return <HomePage admin={false} />;
}
