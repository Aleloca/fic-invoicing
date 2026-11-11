import { isAdmin } from "@/lib/admin-session";
import { env } from "@/lib/env";
import { exchangeCodeForTokens, getUserInfo, listUserCompanies } from "@/lib/fic/client";
import { verifyOAuthState } from "@/lib/oauth-state";
import { prisma } from "@/lib/prisma";
import { connectAccount, ensureCompany } from "@/lib/projects/accounts";

export const dynamic = "force-dynamic";

function redirectTo(path: string): Response {
  return Response.redirect(`${env.publicBaseUrl()}${path}`, 303);
}

/** OAuth redirect target registered in the FIC developer console. */
export async function GET(request: Request): Promise<Response> {
  if (!(await isAdmin())) return redirectTo("/admin/login");

  const url = new URL(request.url);
  const target = verifyOAuthState(url.searchParams.get("state"));
  if (!target) return redirectTo("/admin/fic?error=invalid_oauth_state");

  const project = target.projectId
    ? await prisma.project.findUnique({ where: { id: target.projectId }, select: { id: true, companyId: true } })
    : null;
  const back = project ? `/admin/projects/${project.id}` : "/admin/fic";

  const oauthError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (oauthError || !code) {
    return redirectTo(`${back}?error=${encodeURIComponent(`oauth_${oauthError ?? "missing_code"}`)}`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const user = await getUserInfo(tokens.access_token).catch(() => null);
    const result = await connectAccount(tokens, user, target.accountId);
    if (!result.ok) return redirectTo(`${back}?error=oauth_${result.reason}`);
    const { account } = result;

    // A project without a company gets the only company of the account at once; otherwise the
    // admin chooses among every connected account's companies.
    if (project && !project.companyId) {
      const companies = await listUserCompanies(tokens.access_token);
      if (companies.length === 1) {
        const company = await ensureCompany(account.id, companies[0]);
        await prisma.project.update({ where: { id: project.id }, data: { companyId: company.id } });
        return redirectTo(`${back}?notice=connected`);
      }
      return redirectTo(`${back}/company?account=${account.id}`);
    }
    const notice = target.accountId ? "reconnected" : result.created ? "account_connected" : "reconnected";
    return redirectTo(`${back}?notice=${notice}`);
  } catch (error) {
    console.error("[fic-invoicing] OAuth callback failed", error instanceof Error ? error.message : error);
    return redirectTo(`${back}?error=oauth_callback_failed`);
  }
}
