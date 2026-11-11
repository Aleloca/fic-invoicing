import { isAdmin } from "@/lib/admin-session";
import { apiGuideMarkdown } from "@/lib/api-guide";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** The API integration guide as a Markdown file, for developers and coding agents. */
export async function GET(): Promise<Response> {
  if (!(await isAdmin())) return new Response("Unauthorized", { status: 401 });
  return new Response(apiGuideMarkdown(env.publicBaseUrl()), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="fic-invoicing-api.md"',
      "Cache-Control": "no-store",
    },
  });
}
