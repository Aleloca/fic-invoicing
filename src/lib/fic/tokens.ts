/**
 * Per-tenant FIC access tokens.
 *
 * FIC rotates refresh tokens: after a refresh the previous refresh token is
 * invalid. Two concurrent refreshes for the same tenant would therefore make
 * one of them fail and could leave the tenant disconnected. Refreshes are
 * serialized with a row lock (`SELECT ... FOR UPDATE`) inside an interactive
 * transaction; after acquiring the lock the row is re-read and the refresh is
 * skipped if another request already did it.
 */
import { decrypt, encrypt } from "../crypto";
import { ApiError } from "../errors";
import { prisma } from "../prisma";
import { FicHttpError, refreshTokens, type FicTokenResponse } from "./client";

/** Refresh when the access token expires in less than this. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface FicAccess {
  accessToken: string;
  companyId: number | null;
}

interface TokenRow {
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  tokenExpiresAt: Date | null;
  ficCompanyId: number | null;
  ficNeedsReconnect: boolean | number;
}

export function needsRefresh(expiresAt: Date | null, now: number = Date.now()): boolean {
  return !expiresAt || expiresAt.getTime() - now < REFRESH_MARGIN_MS;
}

function notConnected(): ApiError {
  return new ApiError(409, "fic_not_connected", "This tenant is not connected to Fatture in Cloud yet");
}

function reconnectRequired(): ApiError {
  return new ApiError(
    409,
    "fic_reconnect_required",
    "The Fatture in Cloud authorization is no longer valid: an administrator must reconnect this tenant",
  );
}

function assertUsable(row: TokenRow): void {
  if (Boolean(row.ficNeedsReconnect)) throw reconnectRequired();
  if (!row.accessTokenEnc || !row.refreshTokenEnc) throw notConnected();
}

/** Returns a valid access token for the tenant, refreshing it (serialized) when close to expiry. */
export async function getFicAccess(tenantId: string): Promise<FicAccess> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      accessTokenEnc: true,
      refreshTokenEnc: true,
      tokenExpiresAt: true,
      ficCompanyId: true,
      ficNeedsReconnect: true,
    },
  });
  if (!tenant) throw new ApiError(404, "not_found", "Tenant not found");
  assertUsable(tenant);
  if (!needsRefresh(tenant.tokenExpiresAt)) {
    return { accessToken: decrypt(tenant.accessTokenEnc!), companyId: tenant.ficCompanyId };
  }
  return refreshWithLock(tenantId);
}

/** Refreshes the tenant tokens while holding a row lock. Exported for tests. */
export async function refreshWithLock(tenantId: string): Promise<FicAccess> {
  let rejection: string | null = null;

  const access = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<TokenRow[]>`
        SELECT accessTokenEnc, refreshTokenEnc, tokenExpiresAt, ficCompanyId, ficNeedsReconnect
        FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      const row = rows[0];
      if (!row) throw new ApiError(404, "not_found", "Tenant not found");
      assertUsable(row);

      // Another request may have refreshed while we were waiting for the lock.
      if (!needsRefresh(row.tokenExpiresAt)) {
        return { accessToken: decrypt(row.accessTokenEnc!), companyId: row.ficCompanyId };
      }

      let tokens: FicTokenResponse;
      try {
        tokens = await refreshTokens(decrypt(row.refreshTokenEnc!));
      } catch (error) {
        // 4xx: the refresh token was rejected (revoked, expired, already used).
        // Persist the state so admins and API callers can see it. 5xx / network
        // errors are transient: roll back and let the caller retry later.
        if (error instanceof FicHttpError && error.status >= 400 && error.status < 500) {
          rejection = error.message;
          await tx.tenant.update({
            where: { id: tenantId },
            data: { ficNeedsReconnect: true, ficLastError: `Token refresh rejected: ${error.message}` },
          });
          return null;
        }
        throw error;
      }

      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          accessTokenEnc: encrypt(tokens.access_token),
          refreshTokenEnc: encrypt(tokens.refresh_token),
          tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          ficLastError: null,
        },
      });
      return { accessToken: tokens.access_token, companyId: row.ficCompanyId };
    },
    { maxWait: 20_000, timeout: 40_000 },
  );

  if (rejection || !access) throw reconnectRequired();
  return access;
}

/** Stores freshly obtained tokens (OAuth callback) and clears the reconnect flag. */
export async function saveTokens(tenantId: string, tokens: FicTokenResponse): Promise<void> {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: encrypt(tokens.refresh_token),
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      ficNeedsReconnect: false,
      ficLastError: null,
    },
  });
}
