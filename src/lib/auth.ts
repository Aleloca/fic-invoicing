import type { Tenant } from "@prisma/client";
import { hashApiKey } from "./api-key";
import { env } from "./env";
import { ApiError } from "./errors";
import { prisma } from "./prisma";
import { RateLimiter } from "./rate-limit";

let limiter: RateLimiter | null = null;

export function apiRateLimiter(): RateLimiter {
  limiter ??= new RateLimiter(env.rateLimitPerMinute());
  return limiter;
}

/** Authenticates a public API request with `Authorization: Bearer <api key>`. */
export async function authenticateTenant(request: Request): Promise<Tenant> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) {
    throw new ApiError(401, "unauthorized", "Missing or malformed Authorization header (expected: Bearer <api key>)");
  }

  const keyHash = hashApiKey(match[1]);
  const retryAfter = apiRateLimiter().hit(keyHash);
  if (retryAfter > 0) {
    throw new ApiError(429, "rate_limited", `Too many requests, retry in ${retryAfter}s`, { retryAfterSeconds: retryAfter });
  }

  const tenant = await prisma.tenant.findUnique({ where: { apiKeyHash: keyHash } });
  if (!tenant) throw new ApiError(401, "unauthorized", "Invalid API key");
  if (!tenant.active) throw new ApiError(403, "forbidden", "This tenant is disabled");
  return tenant;
}
