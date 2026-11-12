/**
 * FIC access tokens, one chain per connected Fatture in Cloud account.
 *
 * FIC rotates refresh tokens: after a refresh the previous refresh token is
 * invalid. Two concurrent refreshes for the same account would therefore make
 * one of them fail and could leave the account disconnected. Every project
 * using one of the account's companies shares this chain. Refreshes are
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

interface TokenRow {
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  tokenExpiresAt: Date | null;
  needsReconnect: boolean | number;
}

export function needsRefresh(expiresAt: Date | null, now: number = Date.now()): boolean {
  return !expiresAt || expiresAt.getTime() - now < REFRESH_MARGIN_MS;
}

function notConnected(): ApiError {
  return new ApiError(409, "fic_not_connected", "This Fatture in Cloud account is not connected");
}

function reconnectRequired(): ApiError {
  return new ApiError(
    409,
    "fic_reconnect_required",
    "The Fatture in Cloud authorization is no longer valid: an administrator must reconnect the account",
  );
}

function assertUsable(row: TokenRow): void {
  if (Boolean(row.needsReconnect)) throw reconnectRequired();
  if (!row.accessTokenEnc || !row.refreshTokenEnc) throw notConnected();
}

/** Returns a valid access token for the account, refreshing it (serialized) when close to expiry. */
export async function getFicAccess(accountId: string): Promise<string> {
  const account = await prisma.ficAccount.findUnique({
    where: { id: accountId },
    select: { accessTokenEnc: true, refreshTokenEnc: true, tokenExpiresAt: true, needsReconnect: true },
  });
  if (!account) throw notConnected();
  assertUsable(account);
  if (!needsRefresh(account.tokenExpiresAt)) return decrypt(account.accessTokenEnc!);
  return refreshWithLock(accountId);
}

function rotatedFields(tokens: FicTokenResponse) {
  return {
    accessTokenEnc: encrypt(tokens.access_token),
    refreshTokenEnc: encrypt(tokens.refresh_token),
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    lastError: null,
  };
}

/** Refreshes the account tokens while holding a row lock. Exported for tests. */
export async function refreshWithLock(accountId: string): Promise<string> {
  let rejection: string | null = null;
  // FIC rotates the refresh token: once it has answered, the new pair is the only valid one.
  let rotated: FicTokenResponse | null = null;

  let access: string | null;
  try {
    access = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<TokenRow[]>`
        SELECT accessTokenEnc, refreshTokenEnc, tokenExpiresAt, needsReconnect
        FROM fic_accounts WHERE id = ${accountId} FOR UPDATE`;
      const row = rows[0];
      if (!row) throw notConnected();
      assertUsable(row);

      // Another request may have refreshed while we were waiting for the lock.
      if (!needsRefresh(row.tokenExpiresAt)) return decrypt(row.accessTokenEnc!);

      let tokens: FicTokenResponse;
      try {
        tokens = await refreshTokens(decrypt(row.refreshTokenEnc!));
        rotated = tokens;
      } catch (error) {
        // 4xx: the refresh token was rejected (revoked, expired, already used).
        // Persist the state so admins and API callers can see it. 5xx / network
        // errors are transient: roll back and let the caller retry later.
        if (error instanceof FicHttpError && error.status >= 400 && error.status < 500) {
          rejection = error.message;
          await tx.ficAccount.update({
            where: { id: accountId },
            data: { needsReconnect: true, lastError: `Token refresh rejected: ${error.message}` },
          });
          return null;
        }
        throw error;
      }

      await tx.ficAccount.update({ where: { id: accountId }, data: rotatedFields(tokens) });
      return tokens.access_token;
    },
    { maxWait: 20_000, timeout: 40_000 },
  );
  } catch (error) {
    // The transaction failed (timeout, lost connection) after FIC rotated the tokens:
    // the rollback restored a refresh token FIC no longer accepts. Save the new pair anyway.
    const fresh = rotated as FicTokenResponse | null;
    if (!fresh) throw error;
    console.warn("[fic-invoicing] token refresh transaction failed after rotation; saving the new tokens", error);
    await prisma.ficAccount.update({ where: { id: accountId }, data: rotatedFields(fresh) });
    return fresh.access_token;
  }

  if (rejection || !access) throw reconnectRequired();
  return access;
}

/** The token fields to store for freshly obtained tokens (OAuth callback); clears the reconnect flag. */
export function tokenFields(tokens: FicTokenResponse) {
  return {
    accessTokenEnc: encrypt(tokens.access_token),
    refreshTokenEnc: encrypt(tokens.refresh_token),
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    connectedAt: new Date(),
    needsReconnect: false,
    lastError: null,
  };
}
