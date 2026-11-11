import { isAdmin } from "@/lib/admin-session";
import { env } from "@/lib/env";
import { exchangeCodeForTokens, listUserCompanies } from "@/lib/fic/client";
import { saveTokens } from "@/lib/fic/tokens";
import { verifyOAuthState } from "@/lib/oauth-state";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function redirectTo(path: string): Response {
  return Response.redirect(`${env.publicBaseUrl()}${path}`, 303);
}

/** OAuth redirect target registered in the FIC developer console. */
export async function GET(request: Request): Promise<Response> {
  if (!(await isAdmin())) return redirectTo("/admin/login");

  const url = new URL(request.url);
  const tenantId = verifyOAuthState(url.searchParams.get("state"));
  if (!tenantId) return redirectTo("/admin?error=invalid_oauth_state");

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return redirectTo("/admin?error=unknown_tenant");
  const back = `/admin/tenants/${tenant.id}`;

  const oauthError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (oauthError || !code) {
    return redirectTo(`${back}?error=${encodeURIComponent(`oauth_${oauthError ?? "missing_code"}`)}`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveTokens(tenant.id, tokens);
    const companies = await listUserCompanies(tokens.access_token);

    // Keep the current company if the new authorization still grants it,
    // pick the only one automatically, otherwise let the admin choose.
    const chosen =
      companies.find((c) => c.id === tenant.ficCompanyId) ?? (companies.length === 1 ? companies[0] : undefined);
    if (chosen) {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { ficCompanyId: chosen.id, ficCompanyName: chosen.name, connectedAt: new Date() },
      });
      return redirectTo(`${back}?notice=connected`);
    }
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { ficCompanyId: null, ficCompanyName: null, connectedAt: null },
    });
    return redirectTo(`${back}/company`);
  } catch (error) {
    console.error("[fic-invoicing] OAuth callback failed", error instanceof Error ? error.message : error);
    return redirectTo(`${back}?error=oauth_callback_failed`);
  }
}
